// Initial prompt handler - POST /

import type { Response } from "express";
import { Sandbox } from "e2b";
import { SystemMessage, BaseMessage } from "@langchain/core/messages";
import { streamMultiAgentOrchestrator } from "@/agent/orchestrator";
import { INITIAL_SYSTEM_PROMPT, CONTEXT_SYSTEM_PROMPT } from "@/agent/systemPrompts";
import { prisma } from "@/lib/prisma";
import { MessageRole } from "@/generated/prisma/client";
import type { AuthRequest } from "@/middleware/auth";
import { initializeR2ForSandbox, isR2Configured } from "@/lib/r2";
import { activeSandboxes } from "@/routes/session";
import {
    getOrCreateChat,
    saveMessage,
    isFirstMessage,
    getChatHistory,
    generateCodeSummary
} from "@/routes/services";

const TEMPLATE_ID = process.env.TEMPLATE_ID;
const SANDBOX_PORT = process.env.SANDBOX_PORT;

export async function handleInitialPrompt(req: AuthRequest, res: Response) {
    const { prompt, projectId } = req.body;
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
            console.log(`[Phase 1] Initial project creation for chat ${chatId}`);
            initialMessages = [new SystemMessage(INITIAL_SYSTEM_PROMPT)];
        } else {
            console.log(`[Phase 2] Iterative changes for chat ${chatId}, fetching history`);
            const history = await getChatHistory(chatId, 11);
            history.pop();

            initialMessages = [
                new SystemMessage(CONTEXT_SYSTEM_PROMPT),
                ...history.slice(-10)
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
            session.isStreaming = true;

            const systemPromptToUse = isFirst ? INITIAL_SYSTEM_PROMPT : CONTEXT_SYSTEM_PROMPT;
            console.log(`Using ${isFirst ? 'INITIAL' : 'CONTEXT'} system prompt for orchestrator`);

            const createdFiles: string[] = [];
            let commandCount = 0;

            for await (const event of streamMultiAgentOrchestrator(sandbox, prompt, systemPromptToUse)) {
                if (event.type === 'file_created' && event.filePath) {
                    createdFiles.push(event.filePath);
                }
                if (event.type === 'executing') {
                    commandCount++;
                }
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }

            session.isStreaming = false;

            const summary = generateCodeSummary(createdFiles, commandCount, isFirst ? 'created' : 'updated');

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
}
