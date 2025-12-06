import { Router } from "express";
import type { Request, Response } from "express";
import { Sandbox } from "e2b";
import { HumanMessage, AIMessage, ToolMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { createAgentGraph, type AgentGraph } from "../agent/graph";
import { streamMultiAgentOrchestrator, type WorkerEvent } from "../agent/orchestrator";
import { SYSTEM_PROMPT } from "../agent/systemPrompt";
import type { Plan } from "../agent/types";
import { prisma } from "../lib/prisma";
import { MessageRole } from "../generated/prisma/client";

const router = Router();

const TEMPLATE_ID = process.env.TEMPLATE_ID;
const SANDBOX_PORT = process.env.SANDBOX_PORT;

interface SandboxSession {
    sandbox: Sandbox;
    graph: AgentGraph;
    messages: BaseMessage[];
    sandboxUrl: string;
    plan?: Plan;
    projectId?: string;
    chatId?: string;
}

export const activeSandboxes = new Map<string, SandboxSession>();

// Helper function to extract summary from LLM response
function extractSummary(content: string): { cleanContent: string; summary: string | null } {
    const summaryMatch = content.match(/\[SUMMARY:\s*(.+?)\]/i);
    if (summaryMatch?.[1]) {
        const summary = summaryMatch[1].trim();
        const cleanContent = content.replace(/\[SUMMARY:\s*.+?\]/i, '').trim();
        return { cleanContent, summary };
    }
    return { cleanContent: content, summary: null };
}

// Helper function to get or create chat for a project
async function getOrCreateChat(projectId: string): Promise<string> {
    // Try to find an existing chat for this project
    let chat = await prisma.chat.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' }
    });

    // If no chat exists, create one
    if (!chat) {
        chat = await prisma.chat.create({
            data: { projectId }
        });
    }

    return chat.id;
}

// Helper function to save message to database
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

router.post("/", async (req: Request, res: Response) => {
    const { prompt, projectId, useMultiAgent = true } = req.body;

    try {
        if (!TEMPLATE_ID || !SANDBOX_PORT) {
            return res.status(500).json({ error: 'TEMPLATE_ID or SANDBOX_PORT environment variable is not set' });
        }

        const sandbox = await Sandbox.create(TEMPLATE_ID, {
            timeoutMs: 300_000
        });

        const host = sandbox.getHost(parseInt(SANDBOX_PORT));
        const sandboxUrl = `https://${host}`;
        const sandboxId = sandbox.sandboxId;

        const graph = createAgentGraph(sandbox);
        const initialMessages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT)];

        // Get or create chat for this project if projectId is provided
        let chatId: string | undefined;
        if (projectId) {
            chatId = await getOrCreateChat(projectId);
            // Save user message to database
            await saveMessage(chatId, MessageRole.USER, prompt);
        }

        activeSandboxes.set(sandboxId, {
            sandbox,
            graph,
            messages: initialMessages,
            sandboxUrl,
            projectId,
            chatId
        });

        console.log(`Sandbox created: ${sandboxUrl}, ID: ${sandboxId}${projectId ? `, Project: ${projectId}` : ''}`);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Sandbox-URL', sandboxUrl);
        res.setHeader('X-Sandbox-ID', sandboxId);

        const session = activeSandboxes.get(sandboxId)!;

        if (useMultiAgent) {
            try {
                for await (const event of streamMultiAgentOrchestrator(sandbox, prompt)) {
                    res.write(`data: ${JSON.stringify(event)}\n\n`);

                    if (event.type === 'plan' && event.plan) {
                        session.plan = event.plan;
                    }
                }

                // Save assistant response to database
                // For multi-agent orchestrator, we save a generic completion message
                if (session.chatId) {
                    const summary = "Code generation completed successfully";
                    await saveMessage(session.chatId, MessageRole.ASSISTANT, summary, summary);
                }

                res.write(`data: ${JSON.stringify({ type: 'done', sandboxUrl, sandboxId })}\n\n`);
                res.end();
            } catch (orchestratorError) {
                console.error('Error during multi-agent orchestration:', orchestratorError);
                res.write(`data: ${JSON.stringify({ type: 'error', message: 'Orchestration error occurred' })}\n\n`);
                res.end();
            }
        } else {
            const userMessage = new HumanMessage(prompt);
            session.messages.push(userMessage);

            try {
                const stream = await graph.stream(
                    { messages: session.messages },
                    { streamMode: "messages" }
                );

                for await (const event of stream) {
                    const [message, metadata] = event;

                    if (AIMessage.isInstance(message)) {
                        if (message.content && typeof message.content === 'string') {
                            res.write(`data: ${JSON.stringify({ type: 'text', content: message.content })}\n\n`);
                        }

                        if (message.tool_calls && message.tool_calls.length > 0) {
                            for (const toolCall of message.tool_calls) {
                                res.write(`data: ${JSON.stringify({
                                    type: 'tool_call',
                                    name: toolCall.name,
                                    args: toolCall.args
                                })}\n\n`);
                            }
                        }
                    }

                    if (ToolMessage.isInstance(message)) {
                        res.write(`data: ${JSON.stringify({
                            type: 'tool_result',
                            name: message.name,
                            content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
                        })}\n\n`);
                    }
                }

                const finalResult = await graph.invoke({ messages: session.messages });
                session.messages = finalResult.messages;

                res.write(`data: ${JSON.stringify({ type: 'done', sandboxUrl, sandboxId })}\n\n`);
                res.end();

            } catch (streamError) {
                console.error('Error during streaming:', streamError);
                res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream error occurred' })}\n\n`);
                res.end();
            }
        }

    } catch (error) {
        console.error('Error creating sandbox:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to create sandbox' });
        }
    }
});

router.post("/continue", async (req: Request, res: Response) => {
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

        console.log(`Continuing conversation in sandbox ${sandboxId}, current messages: ${session.messages.length}`);

        const userMessage = new HumanMessage(prompt);
        session.messages.push(userMessage);

        let accumulatedResponse = '';

        try {
            const stream = await session.graph.stream(
                { messages: session.messages },
                { streamMode: "messages" }
            );

            for await (const event of stream) {
                const [message, metadata] = event;

                if (AIMessage.isInstance(message)) {
                    if (message.content && typeof message.content === 'string') {
                        accumulatedResponse += message.content;
                        res.write(`data: ${JSON.stringify({ type: 'text', content: message.content })}\n\n`);
                    }

                    if (message.tool_calls && message.tool_calls.length > 0) {
                        for (const toolCall of message.tool_calls) {
                            res.write(`data: ${JSON.stringify({
                                type: 'tool_call',
                                name: toolCall.name,
                                args: toolCall.args
                            })}\n\n`);
                        }
                    }
                }

                if (ToolMessage.isInstance(message)) {
                    res.write(`data: ${JSON.stringify({
                        type: 'tool_result',
                        name: message.name,
                        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
                    })}\n\n`);
                }
            }

            const finalResult = await session.graph.invoke({ messages: session.messages });
            session.messages = finalResult.messages;

            // Save assistant response to database with extracted summary
            if (session.chatId && accumulatedResponse) {
                const { cleanContent, summary } = extractSummary(accumulatedResponse);
                await saveMessage(session.chatId, MessageRole.ASSISTANT, cleanContent, summary);
            }

            res.write(`data: ${JSON.stringify({ type: 'done', sandboxUrl: session.sandboxUrl, sandboxId })}\n\n`);
            res.end();

        } catch (streamError) {
            console.error('Error during streaming:', streamError);
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream error occurred' })}\n\n`);
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

router.post("/refresh/:sandboxId", async (req: Request, res: Response) => {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    try {
        await session.sandbox.setTimeout(200_000);
        res.json({ success: true, message: 'Sandbox timeout refreshed' });
    } catch (error) {
        console.error('Error refreshing sandbox timeout:', error);
        res.status(500).json({ error: 'Failed to refresh sandbox timeout' });
    }
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
        await session.sandbox.kill();
        activeSandboxes.delete(sandboxId);
        res.json({ success: true, message: 'Sandbox closed' });
    } catch (error) {
        console.error('Error closing sandbox:', error);
        res.status(500).json({ error: 'Failed to close sandbox' });
    }
});

export default router;
