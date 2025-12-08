import { Router } from "express";
import type { Request, Response } from "express";
import { Sandbox } from "e2b";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { streamMultiAgentOrchestrator } from "../agent/orchestrator";
import { INITIAL_SYSTEM_PROMPT, CONTEXT_SYSTEM_PROMPT } from "../agent/systemPrompt";
import { prisma } from "../lib/prisma";
import { MessageRole } from "../generated/prisma/client";
import type { AuthRequest } from "../middleware/auth";
import { initializeR2ForSandbox, backupProject, isR2Configured, ensureR2Mounted } from "../lib/r2";
import { activeSandboxes, pendingShutdowns, SHUTDOWN_DELAY_MS } from "./session";
import { scheduleShutdown, cancelPendingShutdown } from "./shutdown";
export { activeSandboxes } from "./session";

const router = Router();

const TEMPLATE_ID = process.env.TEMPLATE_ID;
const SANDBOX_PORT = process.env.SANDBOX_PORT;

function generateCodeSummary(files: string[], commandCount: number, action: 'created' | 'updated'): string {
    if (files.length === 0) {
        return action === 'created'
            ? "I've set up your project! Let me know what changes you'd like to make."
            : "I've reviewed your request but no changes were needed.";
    }

    // Determine what kind of work was done based on file types
    const fileNames = files.map(f => f.split('/').pop() || f);
    const hasComponents = files.some(f => f.includes('/components/') || f.includes('Component'));
    const hasStyles = files.some(f => f.endsWith('.css') || f.endsWith('.scss'));
    const hasApp = files.some(f => f.includes('App.tsx') || f.includes('App.jsx'));
    const hasPages = files.some(f => f.includes('/pages/') || f.includes('/app/'));

    if (action === 'created') {
        // Initial project creation
        let summary = "I've created your project";

        if (hasApp && hasComponents) {
            summary += " with the main app and components";
        } else if (hasApp) {
            summary += " with the main application";
        } else if (hasComponents) {
            summary += " with the necessary components";
        }

        if (commandCount > 0) {
            summary += " and installed the dependencies";
        }

        summary += ". Let me know what changes you'd like!";
        return summary;
    } else {
        // Updates/iterations
        let summary = "Done! I've updated";

        if (hasStyles && !hasComponents && !hasApp) {
            summary += " the styling";
        } else if (hasComponents && files.length === 1) {
            summary += ` the ${fileNames[0]?.replace('.tsx', '').replace('.jsx', '')} component`;
        } else if (hasApp && files.length === 1) {
            summary += " the main app";
        } else if (files.length <= 2) {
            summary += ` ${fileNames.join(' and ')}`;
        } else {
            summary += ` ${files.length} files including ${fileNames.slice(0, 2).join(', ')}`;
        }

        summary += " as requested. Anything else you'd like me to change?";
        return summary;
    }
}


async function getOrCreateChat(projectId: string): Promise<string> {
    let chat = await prisma.chat.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' }
    });

    if (!chat) {
        chat = await prisma.chat.create({
            data: { projectId }
        });
    }

    return chat.id;
}

async function saveMessage(chatId: string, role: MessageRole, content: string, summary?: string | null) {
    await prisma.message.create({
        data: {
            chatId,
            role,
            content,
            summary: summary || undefined
        }
    });
}

async function isFirstMessage(chatId: string): Promise<boolean> {
    const count = await prisma.message.count({
        where: { chatId }
    });
    return count === 0;
}

async function getChatHistory(chatId: string, limit: number = 10): Promise<BaseMessage[]> {
    const messages = await prisma.message.findMany({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
            role: true,
            content: true
        }
    });

    // Reverse to get chronological order and convert to LangChain messages
    return messages.reverse().map(msg => {
        if (msg.role === MessageRole.USER) {
            return new HumanMessage(msg.content);
        } else if (msg.role === MessageRole.ASSISTANT) {
            return new AIMessage(msg.content);
        } else {
            return new SystemMessage(msg.content);
        }
    });
}


// Routes start here

router.post("/", async (req: AuthRequest, res: Response) => {
    const { prompt, projectId, useMultiAgent = true } = req.body;
    const userId = req.userId;

    // Validate required fields
    if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
    }

    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Verify project exists and belongs to user
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { userId: true }
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        if (project.userId !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (!TEMPLATE_ID || !SANDBOX_PORT) {
            return res.status(500).json({ error: 'TEMPLATE_ID or SANDBOX_PORT environment variable is not set' });
        }

        const sandbox = await Sandbox.create(TEMPLATE_ID, {
            timeoutMs: 300_000
        });

        const host = sandbox.getHost(parseInt(SANDBOX_PORT));
        const sandboxUrl = `https://${host}`;
        const sandboxId = sandbox.sandboxId;

        const chatId = await getOrCreateChat(projectId);

        const isFirst = await isFirstMessage(chatId);

        // Initialize R2 and restore project if this is a returning project
        if (isR2Configured()) {
            const shouldRestore = !isFirst;
            console.log(`[INIT] Initializing R2 for ${isFirst ? 'new' : 'existing'} project ${projectId}`);
            const { mounted, restored } = await initializeR2ForSandbox(sandbox, userId, projectId, shouldRestore);
            if (mounted) {
                console.log(`[INIT] R2 mounted successfully${restored ? ', project restored from backup' : ''}`);
            }
        }

        await saveMessage(chatId, MessageRole.USER, prompt);

        // Build context messages based on whether this is first or subsequent prompt
        let initialMessages: BaseMessage[];

        if (isFirst) {
            // Phase 1: Initial creation - full system prompt, no history
            console.log(`[Phase 1] Initial project creation for chat ${chatId}`);
            initialMessages = [new SystemMessage(INITIAL_SYSTEM_PROMPT)];
        } else {
            // Phase 2: Iterative changes - simplified prompt + last 10 messages
            console.log(`[Phase 2] Iterative changes for chat ${chatId}, fetching history`);
            const history = await getChatHistory(chatId, 11); // Get 11 to exclude the current message
            // Remove the last message (the one we just saved)
            history.pop();

            initialMessages = [
                new SystemMessage(CONTEXT_SYSTEM_PROMPT),
                ...history.slice(-10) // Last 10 messages (or all if < 10)
            ];
            console.log(`Including ${initialMessages.length - 1} previous messages as context`);
        }

        activeSandboxes.set(sandboxId, {
            sandbox,
            messages: initialMessages,
            sandboxUrl,
            projectId,
            chatId,
            userId,
            createdAt: new Date()
        });

        console.log(`Sandbox created: ${sandboxUrl}, ID: ${sandboxId}${projectId ? `, Project: ${projectId}` : ''}`);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Sandbox-URL', sandboxUrl);
        res.setHeader('X-Sandbox-ID', sandboxId);

        const session = activeSandboxes.get(sandboxId)!;

        try {
            // Mark session as streaming
            session.isStreaming = true;

            // Use INITIAL prompt for first message, CONTEXT prompt for subsequent
            const systemPromptToUse = isFirst ? INITIAL_SYSTEM_PROMPT : CONTEXT_SYSTEM_PROMPT;
            console.log(`Using ${isFirst ? 'INITIAL' : 'CONTEXT'} system prompt for orchestrator`);

            // Track created files for summary generation
            const createdFiles: string[] = [];
            let commandCount = 0;

            for await (const event of streamMultiAgentOrchestrator(sandbox, prompt, systemPromptToUse)) {
                // Track file creation events
                if (event.type === 'file_created' && event.filePath) {
                    createdFiles.push(event.filePath);
                }
                if (event.type === 'executing') {
                    commandCount++;
                }
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }

            // Mark streaming as complete
            session.isStreaming = false;

            // Generate meaningful summary
            const summary = generateCodeSummary(createdFiles, commandCount, isFirst ? 'created' : 'updated');

            // Save assistant response to database
            if (session.chatId) {
                await saveMessage(session.chatId, MessageRole.ASSISTANT, summary, summary);
            }

            res.write(`data: ${JSON.stringify({ type: 'summary', message: summary })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'done', sandboxUrl, sandboxId })}\n\n`);
            res.end();
        } catch (orchestratorError) {
            session.isStreaming = false;
            console.error('Error during orchestration:', orchestratorError);
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'Orchestration error occurred' })}\n\n`);
            res.end();
        }

    } catch (error) {
        console.error('Error creating sandbox:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to create sandbox' });
        }
    }
});

/**
 * Reads the main App.tsx file from the sandbox to provide context for the LLM
 * Only reads App.tsx as it's the primary file that gets customized
 */
async function getCurrentProjectContext(sandbox: import("e2b").Sandbox): Promise<string> {
    try {
        const appContent = await sandbox.files.read('/home/user/src/App.tsx');
        if (appContent && typeof appContent === 'string') {
            return `\n\nCURRENT App.tsx:\n\`\`\`tsx\n${appContent}\n\`\`\``;
        }
    } catch {
        // App.tsx might not exist yet
    }
    return '';
}

router.post("/continue", async (req: AuthRequest, res: Response) => {
    const { prompt, sandboxId } = req.body;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        return res.status(404).json({ error: 'Sandbox session not found or expired' });
    }

    try {
        // Save user message to database if chatId exists
        if (session.chatId) {
            await saveMessage(session.chatId, MessageRole.USER, prompt);
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Sandbox-URL', session.sandboxUrl);
        res.setHeader('X-Sandbox-ID', sandboxId);

        console.log(`[Continue] Continuing conversation in sandbox ${sandboxId}`);

        try {
            // Mark session as streaming
            session.isStreaming = true;

            // Get current project context (existing App.tsx)
            console.log(`[Continue] Reading current project context...`);
            const projectContext = await getCurrentProjectContext(session.sandbox);

            // Get conversation history (last 10 messages) in JSON format
            let conversationContext = '';
            if (session.chatId) {
                const messages = await prisma.message.findMany({
                    where: { chatId: session.chatId },
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    select: { role: true, content: true, summary: true }
                });
                if (messages.length > 0) {
                    const history = messages.reverse().map(m => ({
                        role: m.role,
                        content: m.summary || m.content.slice(0, 200)
                    }));
                    conversationContext = `\n\nCONVERSATION HISTORY:\n${JSON.stringify(history, null, 2)}`;
                }
            }

            // Get project description
            let projectDescription = '';
            if (session.projectId) {
                const project = await prisma.project.findUnique({
                    where: { id: session.projectId },
                    select: { name: true, description: true }
                });
                if (project) {
                    projectDescription = `\n\nPROJECT: ${project.name}${project.description ? `\nDescription: ${project.description}` : ''}`;
                }
            }

            // Track created/modified files for summary generation
            const modifiedFiles: string[] = [];
            let commandCount = 0;

            // Build enhanced prompt with full context
            const enhancedPrompt = `${prompt}${projectDescription}${conversationContext}${projectContext}`;

            // Use CONTEXT_SYSTEM_PROMPT for iterative changes
            for await (const event of streamMultiAgentOrchestrator(session.sandbox, enhancedPrompt, CONTEXT_SYSTEM_PROMPT)) {
                // Track file creation events
                if (event.type === 'file_created' && event.filePath) {
                    modifiedFiles.push(event.filePath);
                }
                if (event.type === 'executing') {
                    commandCount++;
                }
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }

            // Mark streaming as complete
            session.isStreaming = false;

            // Generate meaningful summary
            const summary = generateCodeSummary(modifiedFiles, commandCount, 'updated');

            // Save assistant response to database
            if (session.chatId) {
                await saveMessage(session.chatId, MessageRole.ASSISTANT, summary, summary);
            }

            res.write(`data: ${JSON.stringify({ type: 'summary', message: summary })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'done', sandboxUrl: session.sandboxUrl, sandboxId })}\n\n`);
            res.end();

        } catch (streamError) {
            session.isStreaming = false;
            console.error('Error during orchestration:', streamError);
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'Orchestration error occurred' })}\n\n`);
            res.end();
        }

    } catch (error) {
        console.error('Error continuing conversation:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to continue conversation' });
        }
    }
});

router.get("/history/:sandboxId", async (req: Request, res: Response) => {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    const formattedMessages = session.messages.map(msg => {
        const type = AIMessage.isInstance(msg) ? 'ai'
            : HumanMessage.isInstance(msg) ? 'human'
                : ToolMessage.isInstance(msg) ? 'tool'
                    : SystemMessage.isInstance(msg) ? 'system'
                        : 'unknown';

        return {
            type,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            ...(AIMessage.isInstance(msg) && msg.tool_calls
                ? { toolCalls: msg.tool_calls }
                : {}),
            ...(ToolMessage.isInstance(msg)
                ? { name: msg.name }
                : {})
        };
    });

    res.json({
        sandboxId,
        sandboxUrl: session.sandboxUrl,
        messageCount: session.messages.length,
        messages: formattedMessages
    });
});

router.post("/load/:projectId", async (req: AuthRequest, res: Response) => {
    const projectId = req.params.projectId;
    const userId = req.userId;

    if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
    }

    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const project = await prisma.project.findFirst({
            where: { id: projectId, userId }
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if there's already an active sandbox for this project
        for (const [sandboxId, session] of activeSandboxes) {
            if (session.projectId === projectId) {
                console.log(`[LOAD] Found existing sandbox ${sandboxId} for project ${projectId}`);

                // If sandbox is shutting down, it cannot be reused
                if (session.isShuttingDown) {
                    console.log(`[LOAD] Sandbox ${sandboxId} is shutting down, returning status to frontend`);
                    return res.status(409).json({
                        error: 'Project is being backed up',
                        status: 'backing_up',
                        message: 'Please wait while your project is being saved...'
                    });
                }

                // Cancel any pending shutdown
                cancelPendingShutdown(sandboxId);

                // If backup is in progress, wait for it to complete
                if (session.isBackingUp) {
                    console.log(`[LOAD] Backup in progress for ${sandboxId}, waiting for completion...`);
                    let waitTime = 0;
                    const maxWaitTime = 120000; // 2 minutes max wait
                    const pollInterval = 1000; // 1 second

                    while (session.isBackingUp && waitTime < maxWaitTime) {
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                        waitTime += pollInterval;
                    }

                    if (session.isBackingUp) {
                        console.log(`[LOAD] Backup still in progress after ${maxWaitTime / 1000}s, proceeding anyway`);
                    } else {
                        console.log(`[LOAD] Backup completed, continuing with load`);
                    }
                }

                // Extend sandbox timeout since user is back
                try {
                    await session.sandbox.setTimeout(15 * 60 * 1000); // 15 minutes
                    console.log(`[LOAD] Extended sandbox timeout to 15 minutes`);
                } catch (timeoutErr) {
                    console.warn(`[LOAD] Could not extend sandbox timeout:`, timeoutErr);
                }

                return res.json({
                    sandboxId,
                    sandboxUrl: session.sandboxUrl,
                    restored: false,
                    message: 'Using existing sandbox'
                });
            }
        }

        console.log(`[LOAD] Creating new sandbox for project ${projectId}`);
        const sandbox = await Sandbox.create(TEMPLATE_ID!, {
            timeoutMs: 300_000
        });

        const host = sandbox.getHost(parseInt(SANDBOX_PORT!));
        const sandboxUrl = `https://${host}`;
        const sandboxId = sandbox.sandboxId;

        // Initialize R2 and restore project if backup exists
        let restored = false;
        if (isR2Configured()) {
            const shouldRestore = !!project.r2BackupPath;
            console.log(`[LOAD] Initializing R2 for project ${projectId} (shouldRestore: ${shouldRestore})`);
            const result = await initializeR2ForSandbox(sandbox, userId, projectId, shouldRestore);
            restored = result.restored;
            if (result.mounted) {
                console.log(`[LOAD] R2 initialized${restored ? ', project restored from backup' : ', no backup to restore'}`);
            }

            // If restored, run npm install to reinstall dependencies
            if (restored) {
                console.log(`[LOAD] Running npm install to restore dependencies...`);
                try {
                    // Use npm install (more reliable than npm ci for various scenarios)
                    // Pipe through tail to limit output but still capture enough for debugging
                    const npmResult = await sandbox.commands.run(
                        'cd /home/user && npm install --legacy-peer-deps 2>&1',
                        { timeoutMs: 180000 }
                    );

                    if (npmResult.exitCode === 0) {
                        console.log(`[LOAD] ✓ Dependencies installed successfully`);
                    } else {
                        console.error(`[LOAD] ✗ npm install failed with exit code ${npmResult.exitCode}`);
                        console.error(`[LOAD] stdout:`, npmResult.stdout.slice(-500));
                        console.error(`[LOAD] stderr:`, npmResult.stderr.slice(-500));
                    }
                } catch (npmError) {
                    console.error(`[LOAD] Error running npm install:`, npmError);
                }
            }
        }

        const chatId = await getOrCreateChat(projectId);

        activeSandboxes.set(sandboxId, {
            sandbox,
            messages: [],
            sandboxUrl,
            projectId,
            chatId,
            userId,
            createdAt: new Date()
        });

        console.log(`[LOAD] Sandbox ${sandboxId} ready for project ${projectId}`);

        res.json({
            sandboxId,
            sandboxUrl,
            restored,
            message: restored ? 'Project restored from backup' : 'New sandbox created'
        });
    } catch (error) {
        console.error('[LOAD] Error loading project:', error);
        res.status(500).json({ error: 'Failed to load project' });
    }
});

router.post("/refresh/:sandboxId", async (req: Request, res: Response) => {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    // Cancel any pending shutdown - user is back
    const wasPending = cancelPendingShutdown(sandboxId);
    if (wasPending) {
        console.log(`[REFRESH] User returned, cancelled pending shutdown for ${sandboxId}`);
    }

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    try {
        await session.sandbox.setTimeout(200_000);
        res.json({ success: true, message: 'Sandbox timeout refreshed', cancelledShutdown: wasPending });
    } catch (error) {
        console.error('Error refreshing sandbox timeout:', error);
        res.status(500).json({ error: 'Failed to refresh sandbox timeout' });
    }
});

router.post("/notify-leaving/:sandboxId", async (req: Request, res: Response) => {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    console.log(`[NOTIFY-LEAVING] Received for sandbox ${sandboxId}`);

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        console.log(`[NOTIFY-LEAVING] Session not found for ${sandboxId}`);
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    const projectId = session.projectId;
    const userId = session.userId;

    console.log(`[NOTIFY-LEAVING] Project: ${projectId}, User: ${userId}`);

    if (!projectId || !userId) {
        return res.status(400).json({ error: 'Session missing projectId or userId' });
    }

    // Schedule shutdown after delay
    scheduleShutdown(sandboxId, projectId, userId);

    res.json({
        success: true,
        message: `Sandbox shutdown scheduled in ${SHUTDOWN_DELAY_MS / 1000} seconds`,
        scheduledShutdownAt: new Date(Date.now() + SHUTDOWN_DELAY_MS).toISOString()
    });
});

// Get project backup status (for frontend to check if project can be opened)
router.get("/status/:projectId", async (req: Request, res: Response) => {
    const projectId = req.params.projectId;

    if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
    }

    // Check if any sandbox for this project is shutting down
    for (const [sandboxId, session] of activeSandboxes) {
        if (session.projectId === projectId) {
            if (session.isShuttingDown || session.isBackingUp) {
                return res.json({
                    status: 'backing_up',
                    message: 'Project is being backed up...'
                });
            }
            return res.json({
                status: 'active',
                message: 'Project is active'
            });
        }
    }

    return res.json({
        status: 'ready',
        message: 'Project is ready to load'
    });
});

router.delete("/:sandboxId", async (req: Request, res: Response) => {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    try {
        // Backup project to R2 before killing sandbox
        if (session.userId && session.projectId && isR2Configured()) {
            console.log(`[DELETE] Preparing to backup project ${session.projectId}`);

            // Ensure R2 is still mounted
            const mountReady = await ensureR2Mounted(session.sandbox);
            if (!mountReady) {
                console.error(`[DELETE] ✗ Cannot backup - R2 mount not available`);
            } else {
                console.log(`[DELETE] Backing up project ${session.projectId} before manual termination`);
                const backed = await backupProject(session.sandbox, session.userId, session.projectId);
                if (backed) {
                    // Update project with R2 backup path
                    const r2BackupPath = `/${session.userId}/${session.projectId}/`;
                    await prisma.project.update({
                        where: { id: session.projectId },
                        data: {
                            r2BackupPath,
                            lastBackupAt: new Date()
                        }
                    });
                    console.log(`[DELETE] ✓ Project ${session.projectId} backed up successfully`);
                } else {
                    console.error(`[DELETE] ✗ Failed to backup project ${session.projectId}`);
                }
            }
        }

        await session.sandbox.kill();
        activeSandboxes.delete(sandboxId);
        res.json({ success: true, message: 'Sandbox closed' });
    } catch (error) {
        console.error('Error closing sandbox:', error);
        res.status(500).json({ error: 'Failed to close sandbox' });
    }
});

router.get("/download/:sandboxId", async (req: Request, res: Response) => {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    try {
        const { sandbox } = session;

        const excludePatterns = [
            'node_modules',
            '.git',
            '.env',
            '.env.local',
            '.env.production',
            '.e2b',
            'e2b.toml',
            '.cache',
            'dist',
            'build',
            '.next',
            '*.log',
            '.DS_Store',
            'bun.lockb',
            'package-lock.json',
            'yarn.lock'
        ];

        const excludeArgs = excludePatterns.map(p => `-x '${p}' -x '${p}/*'`).join(' ');

        const zipFileName = `project-${Date.now()}.zip`;
        const createZipCmd = `cd /home/user && zip -qr /tmp/${zipFileName} . ${excludeArgs}`;

        console.log(`[DOWNLOAD] Creating zip archive`);
        const result = await sandbox.commands.run(createZipCmd);

        if (result.exitCode !== 0) {
            console.error(`[DOWNLOAD] Failed to create zip: ${result.stderr}`);
            return res.status(500).json({ error: 'Failed to create project archive' });
        }

        const zipContent = await sandbox.files.read(`/tmp/${zipFileName}`);

        await sandbox.commands.run(`rm /tmp/${zipFileName}`);

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

        if (typeof zipContent === 'string') {
            res.send(Buffer.from(zipContent, 'binary'));
        } else {
            res.send(zipContent);
        }

        console.log(`[DOWNLOAD] Project downloaded successfully for sandbox ${sandboxId}`);
    } catch (error) {
        console.error('Error downloading project:', error);
        res.status(500).json({ error: 'Failed to download project' });
    }
});

export default router;

