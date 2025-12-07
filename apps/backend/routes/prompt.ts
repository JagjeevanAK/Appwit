import { Router } from "express";
import type { Request, Response } from "express";
import { Sandbox } from "e2b";
import { HumanMessage, AIMessage, ToolMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { streamMultiAgentOrchestrator, type StreamEvent } from "../agent/orchestrator";
import { INITIAL_SYSTEM_PROMPT, CONTEXT_SYSTEM_PROMPT } from "../agent/systemPrompt";
import type { Plan } from "../agent/types";
import { prisma } from "../lib/prisma";
import { MessageRole } from "../generated/prisma/client";
import type { AuthRequest } from "../middleware/auth";
import { performFullRestore, performFullBackup, isR2Configured } from "../lib/r2";

const router = Router();

const TEMPLATE_ID = process.env.TEMPLATE_ID;
const SANDBOX_PORT = process.env.SANDBOX_PORT;

interface SandboxSession {
    sandbox: Sandbox;
    messages: BaseMessage[];
    sandboxUrl: string;
    plan?: Plan;
    projectId?: string;
    chatId?: string;
    userId?: string;
}

export const activeSandboxes = new Map<string, SandboxSession>();

interface PendingShutdown {
    timeoutId: NodeJS.Timeout;
    scheduledAt: Date;
    projectId: string;
    userId: string;
}

const pendingShutdowns = new Map<string, PendingShutdown>();
const SHUTDOWN_DELAY_MS = 1 * 60 * 1000;

function extractSummary(content: string): { cleanContent: string; summary: string | null } {
    const summaryMatch = content.match(/\[SUMMARY:\s*(.+?)\]/i);
    if (summaryMatch?.[1]) {
        const summary = summaryMatch[1].trim();
        const cleanContent = content.replace(/\[SUMMARY:\s*.+?\]/i, '').trim();
        return { cleanContent, summary };
    }
    return { cleanContent: content, summary: null };
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

// Cancel a pending shutdown for a sandbox (called when user returns)
function cancelPendingShutdown(sandboxId: string): boolean {
    const pending = pendingShutdowns.get(sandboxId);
    if (pending) {
        clearTimeout(pending.timeoutId);
        pendingShutdowns.delete(sandboxId);
        console.log(`[SHUTDOWN] Cancelled pending shutdown for sandbox ${sandboxId}`);
        return true;
    }
    return false;
}

// Schedule a delayed shutdown with R2 backup
function scheduleShutdown(sandboxId: string, projectId: string, userId: string): void {
    // Cancel any existing pending shutdown first
    cancelPendingShutdown(sandboxId);

    const timeoutId = setTimeout(async () => {
        await performShutdownWithBackup(sandboxId);
    }, SHUTDOWN_DELAY_MS);

    pendingShutdowns.set(sandboxId, {
        timeoutId,
        scheduledAt: new Date(),
        projectId,
        userId
    });

    console.log(`[SHUTDOWN] Scheduled shutdown for sandbox ${sandboxId} in ${SHUTDOWN_DELAY_MS / 1000}s`);
}

// Perform backup and shutdown
async function performShutdownWithBackup(sandboxId: string): Promise<void> {
    const session = activeSandboxes.get(sandboxId);
    const pending = pendingShutdowns.get(sandboxId);

    if (!session) {
        console.log(`[SHUTDOWN] Session ${sandboxId} not found, skipping`);
        pendingShutdowns.delete(sandboxId);
        return;
    }

    const projectId = session.projectId || pending?.projectId;
    const userId = session.userId || pending?.userId;

    console.log(`[SHUTDOWN] Executing scheduled shutdown for sandbox ${sandboxId}`);

    try {
        // Perform R2 backup if configured
        if (userId && projectId && isR2Configured()) {
            console.log(`[R2] Backing up project ${projectId} before scheduled termination`);
            const backed = await performFullBackup(session.sandbox, userId, projectId);

            if (backed) {
                // Update project with R2 backup path
                const r2BackupPath = `/${userId}/${projectId}/`;
                await prisma.project.update({
                    where: { id: projectId },
                    data: {
                        r2BackupPath,
                        lastBackupAt: new Date()
                    }
                });
                console.log(`[R2] Project ${projectId} backed up to ${r2BackupPath}`);
            } else {
                console.warn(`[R2] Failed to backup project ${projectId}`);
            }
        }

        // Kill the sandbox
        await session.sandbox.kill();
        console.log(`[SHUTDOWN] Sandbox ${sandboxId} killed successfully`);
    } catch (error) {
        console.error(`[SHUTDOWN] Error during shutdown of ${sandboxId}:`, error);
    } finally {
        // Cleanup
        activeSandboxes.delete(sandboxId);
        pendingShutdowns.delete(sandboxId);
    }
}

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

        // Restore project files from R2 if this is a returning project
        if (!isFirst && isR2Configured()) {
            console.log(`[R2] Attempting to restore project ${projectId} for user ${userId}`);
            const restored = await performFullRestore(sandbox, userId, projectId);
            if (restored) {
                console.log(`[R2] Project ${projectId} restored from backup`);
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
            userId
        });

        console.log(`Sandbox created: ${sandboxUrl}, ID: ${sandboxId}${projectId ? `, Project: ${projectId}` : ''}`);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Sandbox-URL', sandboxUrl);
        res.setHeader('X-Sandbox-ID', sandboxId);

        const session = activeSandboxes.get(sandboxId)!;

        try {
            // Use INITIAL prompt for first message, CONTEXT prompt for subsequent
            const systemPromptToUse = isFirst ? INITIAL_SYSTEM_PROMPT : CONTEXT_SYSTEM_PROMPT;
            console.log(`Using ${isFirst ? 'INITIAL' : 'CONTEXT'} system prompt for orchestrator`);

            for await (const event of streamMultiAgentOrchestrator(sandbox, prompt, systemPromptToUse)) {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }

            // Save assistant response to database
            if (session.chatId) {
                const summary = "Code generation completed successfully";
                await saveMessage(session.chatId, MessageRole.ASSISTANT, summary, summary);
            }

            res.write(`data: ${JSON.stringify({ type: 'done', sandboxUrl, sandboxId })}\n\n`);
            res.end();
        } catch (orchestratorError) {
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
            // Use CONTEXT_SYSTEM_PROMPT for iterative changes
            for await (const event of streamMultiAgentOrchestrator(session.sandbox, prompt, CONTEXT_SYSTEM_PROMPT)) {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }

            // Save assistant response to database
            if (session.chatId) {
                const summary = "Code changes completed successfully";
                await saveMessage(session.chatId, MessageRole.ASSISTANT, summary, summary);
            }

            res.write(`data: ${JSON.stringify({ type: 'done', sandboxUrl: session.sandboxUrl, sandboxId })}\n\n`);
            res.end();

        } catch (streamError) {
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
                // Cancel any pending shutdown
                cancelPendingShutdown(sandboxId);
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

        let restored = false;
        if (isR2Configured() && project.r2BackupPath) {
            console.log(`[LOAD] Restoring project ${projectId} from R2`);
            restored = await performFullRestore(sandbox, userId, projectId);
            if (restored) {
                console.log(`[LOAD] Project ${projectId} restored from R2 backup`);
            } else {
                console.log(`[LOAD] No backup found for project ${projectId}`);
            }
        }

        const chatId = await getOrCreateChat(projectId);

        activeSandboxes.set(sandboxId, {
            sandbox,
            messages: [],
            sandboxUrl,
            projectId,
            chatId,
            userId
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
            console.log(`[R2] Backing up project ${session.projectId} before termination`);
            const backed = await performFullBackup(session.sandbox, session.userId, session.projectId);
            if (backed) {
                console.log(`[R2] Project ${session.projectId} backed up successfully`);
            } else {
                console.warn(`[R2] Failed to backup project ${session.projectId}`);
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

