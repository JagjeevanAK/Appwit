import { createAgent, toolCallLimitMiddleware } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";
import type { Sandbox } from "e2b";
import { createSandboxTools } from "../tools";
import { INITIAL_SYSTEM_PROMPT } from "./systemPrompt";

const MAX_ITERATIONS = 15;

const createModel = () => {
    return new ChatOpenAI({
        model: "anthropic/claude-sonnet-4",
        temperature: 0,
        configuration: {
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY,
        },
    });
};

export function createAgentGraph(sandbox: Sandbox) {
    console.log('[AGENT] Creating agent graph with sandbox:', sandbox.sandboxId);
    const tools = createSandboxTools(sandbox);
    console.log('[AGENT] Tools created:', tools.map((t: { name: string }) => t.name));
    const model = createModel();

    const agent = createAgent({
        model,
        tools,
        systemPrompt: INITIAL_SYSTEM_PROMPT,
        middleware: [
            toolCallLimitMiddleware({ runLimit: MAX_ITERATIONS })
        ]
    });

    console.log('[AGENT] Agent created successfully');
    return agent;
}

export type AgentGraph = ReturnType<typeof createAgentGraph>;

export async function* streamAgentResponse(
    graph: AgentGraph,
    userMessage: string,
    previousMessages: (HumanMessage | AIMessage | ToolMessage | SystemMessage)[] = []
) {
    const inputMessages = [
        ...previousMessages,
        new HumanMessage(userMessage)
    ];

    console.log('[AGENT] Starting agent stream');
    console.log('[AGENT] User message:', userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : ''));
    console.log('[AGENT] Previous messages count:', previousMessages.length);

    let eventCount = 0;
    let toolCallCount = 0;
    let textChunks = 0;

    try {
        for await (const event of await graph.stream(
            { messages: inputMessages },
            {
                streamMode: "messages",
            }
        )) {
            eventCount++;
            const [message, metadata] = event;

            if (AIMessage.isInstance(message)) {
                if (message.content && typeof message.content === 'string') {
                    textChunks++;
                    if (textChunks <= 3 || textChunks % 10 === 0) {
                        console.log(`[AGENT] Text chunk #${textChunks}:`, message.content.substring(0, 50));
                    }
                    yield {
                        type: 'text' as const,
                        content: message.content
                    };
                }

                if (message.tool_calls && message.tool_calls.length > 0) {
                    for (const toolCall of message.tool_calls) {
                        toolCallCount++;
                        console.log(`[AGENT] Tool call #${toolCallCount}:`, toolCall.name);
                        console.log('[AGENT] Tool args:', JSON.stringify(toolCall.args).substring(0, 200));
                        yield {
                            type: 'tool_call' as const,
                            name: toolCall.name,
                            args: toolCall.args
                        };
                    }
                }
            }

            if (ToolMessage.isInstance(message)) {
                const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
                console.log('[AGENT] Tool result:', content.substring(0, 100));
                yield {
                    type: 'tool_result' as const,
                    content: content
                };
            }
        }

        console.log('[AGENT] Stream completed');
        console.log(`[AGENT] Stats: ${eventCount} events, ${toolCallCount} tool calls, ${textChunks} text chunks`);

    } catch (error) {
        console.error('[AGENT] Stream error:', error);
        throw error;
    }
}

export async function runAgent(
    graph: AgentGraph,
    userMessage: string,
    previousMessages: (HumanMessage | AIMessage | ToolMessage | SystemMessage)[] = []
) {
    console.log('[AGENT] Running agent (non-streaming)');
    const inputMessages = [
        ...previousMessages,
        new HumanMessage(userMessage)
    ];

    const result = await graph.invoke({ messages: inputMessages });

    console.log('[AGENT] Agent run completed, messages:', result.messages.length);
    return result.messages;
}
