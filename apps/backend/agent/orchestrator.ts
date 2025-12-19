// Main orchestrator - sets up the graph and exports run/stream functions

import { StateGraph, START, END } from "@langchain/langgraph";
import type { Sandbox } from "e2b";
import { INITIAL_SYSTEM_PROMPT } from "./systemPrompts";
import type { FileContent, Plan, ReviewResult } from "./types";

// Import all nodes from modular files
import {
    GraphState,
    type StreamEvent,
    log,
    plannerNode,
    coderNode,
    createThemeApplicatorNode,
    createCommandHandlerNode,
    createWriterNode,
    reviewerNode,
    shouldRetry
} from "./nodes";

// Re-export StreamEvent for external use
export type { StreamEvent };

function createGraph(sandbox: Sandbox) {
    const themeApplicator = createThemeApplicatorNode(sandbox);
    const commandHandler = createCommandHandlerNode(sandbox);
    const writer = createWriterNode(sandbox);

    const graph = new StateGraph(GraphState)
        // Nodes
        .addNode("planner", plannerNode)
        .addNode("codegen", coderNode)
        .addNode("themeApplicator", themeApplicator)
        .addNode("commandHandler", commandHandler)
        .addNode("writer", writer)
        .addNode("reviewer", reviewerNode)
        // Edges - flow with planner and reviewer
        .addEdge(START, "planner")
        .addEdge("planner", "codegen")
        .addEdge("codegen", "themeApplicator")
        .addEdge("themeApplicator", "commandHandler")
        .addEdge("commandHandler", "writer")
        .addEdge("writer", "reviewer")
        // Conditional edge for retry logic
        .addConditionalEdges("reviewer", shouldRetry, {
            "codegen": "codegen",
            "__end__": END
        });

    return graph.compile();
}

export async function runOrchestrator(
    sandbox: Sandbox,
    prompt: string,
    systemPrompt: string = INITIAL_SYSTEM_PROMPT
): Promise<{ files: FileContent[]; writtenFiles: string[] }> {
    log.orchestrator('Starting code generation');

    const graph = createGraph(sandbox);
    const result = await graph.invoke({
        prompt,
        systemPrompt,
        files: [],
        commands: [],
        writtenFiles: []
    });

    log.orchestrator('Code generation complete');
    return {
        files: result.files || [],
        writtenFiles: result.writtenFiles || []
    };
}

export async function* streamOrchestrator(
    sandbox: Sandbox,
    prompt: string,
    systemPrompt: string = INITIAL_SYSTEM_PROMPT
): AsyncGenerator<StreamEvent> {
    log.orchestrator('Starting code generation (streaming)');

    const graph = createGraph(sandbox);

    // Create a write function for progressive file writing during codegen
    const writeFilesToSandbox = async (files: FileContent[]): Promise<string[]> => {
        const writtenPaths: string[] = [];
        for (const file of files) {
            try {
                // Create directory if needed
                const dir = file.filePath.substring(0, file.filePath.lastIndexOf('/'));
                if (dir) {
                    await sandbox.commands.run(`mkdir -p ${dir}`);
                }
                // Write file
                await sandbox.files.write(file.filePath, file.content);
                writtenPaths.push(file.filePath);
                log.orchestrator(`[PROGRESSIVE] Written: ${file.filePath}`);
            } catch (error) {
                log.orchestrator(`[PROGRESSIVE] Failed to write ${file.filePath}:`, error);
            }
        }
        return writtenPaths;
    };

    yield { type: 'planning', message: 'Analyzing your request...' };

    try {
        const stream = graph.streamEvents(
            { prompt, systemPrompt, files: [], commands: [], writtenFiles: [] },
            {
                version: "v2",
                configurable: {
                    writeFiles: writeFilesToSandbox
                }
            }
        );

        let files: FileContent[] = [];
        const emittedWriteCompletes = new Set<string>();

        for await (const event of stream) {
            if (event.event === "on_chain_end") {
                // Planner completed
                if (event.name === "planner" && event.data?.output?.plan) {
                    const plan = event.data.output.plan as Plan;
                    yield {
                        type: 'plan_complete',
                        message: `Plan created: ${plan.tasks.length} files to generate`,
                        plan
                    };
                }

                // Codegen completed
                if (event.name === "codegen" && event.data?.output?.files) {
                    files = event.data.output.files as FileContent[];
                    const commands = (event.data.output.commands || []) as string[];

                    yield { type: 'generating', message: `Generated ${files.length} files, ${commands.length} commands` };

                    // Emit command execution events
                    for (const cmd of commands) {
                        yield { type: 'executing', message: `Running: ${cmd}` };
                    }
                }

                // Writer completed
                if (event.name === "writer" && event.data?.output?.writtenFiles) {
                    const written = event.data.output.writtenFiles as string[];
                    for (const filePath of written) {
                        if (!emittedWriteCompletes.has(filePath)) {
                            emittedWriteCompletes.add(filePath);
                            yield { type: 'file_created', filePath, message: `Created ${filePath}` };
                        }
                    }
                }

                // Reviewer completed
                if (event.name === "reviewer" && event.data?.output?.reviewResult) {
                    const result = event.data.output.reviewResult as ReviewResult;
                    yield {
                        type: 'review_complete',
                        message: result.status === 'success'
                            ? 'All tasks completed'
                            : `Issues found: ${result.problems?.length || 0}`,
                        reviewResult: result
                    };

                    // If retrying, emit retrying event
                    if (result.status === 'issues' && event.data?.output?.retryCount === 1) {
                        yield { type: 'retrying', message: 'Regenerating missing files...' };
                    }
                }
            }
        }

        log.orchestrator('Code generation complete');
        yield { type: 'done', message: 'Code generation complete' };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.orchestrator(`Error: ${errorMessage}`);
        yield { type: 'error', message: errorMessage };
    }
}

// Legacy aliases for backward compatibility
export const streamMultiAgentOrchestrator = streamOrchestrator;
export const runMultiAgentOrchestrator = runOrchestrator;
