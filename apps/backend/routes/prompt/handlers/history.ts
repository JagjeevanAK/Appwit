// History handler - GET /history/:sandboxId

import type { Request, Response } from "express";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { activeSandboxes } from "@/routes/session";

export async function handleGetHistory(req: Request, res: Response) {
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
}
