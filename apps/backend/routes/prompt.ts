import { Router } from "express";
import type { Request, Response } from "express";
import { Sandbox } from "e2b";
import { HumanMessage, AIMessage, ToolMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { createAgentGraph, type AgentGraph } from "../agent/graph";
import { streamMultiAgentOrchestrator, type WorkerEvent } from "../agent/orchestrator";
import { SYSTEM_PROMPT } from "../agent/systemPrompt";
import type { Plan } from "../agent/types";

const router = Router();

const TEMPLATE_ID = process.env.TEMPLATE_ID;
const SANDBOX_PORT = process.env.SANDBOX_PORT;

interface SandboxSession {
    sandbox: Sandbox;
    graph: AgentGraph;
    messages: BaseMessage[];
    sandboxUrl: string;
    plan?: Plan;
}

export const activeSandboxes = new Map<string, SandboxSession>();

router.post("/", async (req: Request, res: Response) => {
    const { prompt, useMultiAgent = true } = req.body;

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

        activeSandboxes.set(sandboxId, {
            sandbox,
            graph,
            messages: initialMessages,
            sandboxUrl
        });

        console.log(`Sandbox created: ${sandboxUrl}, ID: ${sandboxId}`);

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
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Sandbox-URL', session.sandboxUrl);
        res.setHeader('X-Sandbox-ID', sandboxId);

        console.log(`Continuing conversation in sandbox ${sandboxId}, current messages: ${session.messages.length}`);

        const userMessage = new HumanMessage(prompt);
        session.messages.push(userMessage);

        try {
            const stream = await session.graph.stream(
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

            const finalResult = await session.graph.invoke({ messages: session.messages });
            session.messages = finalResult.messages;

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
