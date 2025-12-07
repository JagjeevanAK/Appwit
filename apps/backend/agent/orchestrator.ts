import { StateGraph, Send, Annotation, START, END } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Sandbox } from "e2b";
import { INITIAL_SYSTEM_PROMPT } from "./systemPrompt";
import { CodeGenerationSchema } from "./types";
import type { FileContent, CodeGeneration, Plan } from "./types";

const log = {
    coder: (msg: string, ...args: unknown[]) => console.log(`\x1b[36m[CODER]\x1b[0m ${msg}`, ...args),
    writer: (file: string, msg: string, ...args: unknown[]) => console.log(`\x1b[33m[WRITER ${file}]\x1b[0m ${msg}`, ...args),
    orchestrator: (msg: string, ...args: unknown[]) => console.log(`\x1b[32m[ORCHESTRATOR]\x1b[0m ${msg}`, ...args),
};

const createModel = () => {
    return new ChatOpenAI({
        model: "anthropic/claude-sonnet-4",
        configuration: {
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY,
        },
    });
};

function extractJSONFallback(text: string): CodeGeneration {
    let jsonStr = text;

    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
        jsonStr = codeBlockMatch[1].trim();
    } else {
        const jsonMatch = text.match(/\{[\s\S]*"files"[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        } else {
            const arrayMatch = text.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                jsonStr = arrayMatch[0];
            }
        }
    }

    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed)) {
        return { files: parsed.map(f => ({ filePath: f.filePath || f.path, content: f.content })) };
    }

    if (parsed.files && Array.isArray(parsed.files)) {
        return { files: parsed.files.map((f: { filePath?: string; path?: string; content: string }) => ({ filePath: f.filePath || f.path, content: f.content })) };
    }

    throw new Error('Could not extract files from response');
}

const OrchestratorState = Annotation.Root({
    userPrompt: Annotation<string>(),
    systemPrompt: Annotation<string>(),
    files: Annotation<FileContent[]>(),
    writtenFiles: Annotation<string[]>({
        reducer: (curr, update) => [...curr, ...update],
        default: () => [],
    }),
});

const WriterState = Annotation.Root({
    filePath: Annotation<string>(),
    content: Annotation<string>(),
});

type OrchestratorStateType = typeof OrchestratorState.State;
type WriterStateType = typeof WriterState.State;

async function coderNode(state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> {
    log.coder('Generating code...');
    log.coder('Prompt:', state.userPrompt.slice(0, 100) + (state.userPrompt.length > 100 ? '...' : ''));
    log.coder('Using system prompt type:', state.systemPrompt === INITIAL_SYSTEM_PROMPT ? 'INITIAL' : 'CONTEXT');

    const startTime = Date.now();
    const structuredModel = createModel().withStructuredOutput(CodeGenerationSchema);

    const systemPromptToUse = state.systemPrompt || INITIAL_SYSTEM_PROMPT;

    let result: CodeGeneration;
    try {
        result = await structuredModel.invoke([
            new SystemMessage(systemPromptToUse),
            new HumanMessage(state.userPrompt)
        ]);
    } catch (structuredError) {
        log.coder('Structured output failed, trying fallback...');
        const rawModel = createModel();
        const response = await rawModel.invoke([
            new SystemMessage(systemPromptToUse),
            new HumanMessage(state.userPrompt)
        ]);
        const responseText = typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);
        result = extractJSONFallback(responseText);
    }

    if (!result?.files?.length) {
        throw new Error('No files generated');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.coder(`Generated ${result.files.length} files in ${duration}s`);
    result.files.forEach(f => log.coder(`  - ${f.filePath}`));

    return { files: result.files };
}

function assignWriters(state: OrchestratorStateType): Send[] {
    if (!state.files || state.files.length === 0) {
        log.orchestrator('No files to write');
        return [];
    }

    log.orchestrator(`Spawning ${state.files.length} parallel writers...`);

    return state.files.map(file => {
        return new Send("writer", {
            filePath: file.filePath,
            content: file.content,
        });
    });
}

function createWriterNode(sandbox: Sandbox) {
    return async (state: WriterStateType): Promise<{ writtenFiles: string[] }> => {
        const { filePath, content } = state;

        log.writer(filePath, 'Writing file...');

        try {
            const dir = filePath.substring(0, filePath.lastIndexOf('/'));
            if (dir) {
                await sandbox.commands.run(`mkdir -p ${dir}`);
            }

            await sandbox.files.write(filePath, content);

            log.writer(filePath, 'Done');

            return { writtenFiles: [filePath] };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.writer(filePath, `Failed: ${errorMessage}`);

            return { writtenFiles: [] };
        }
    };
}

function createOrchestratorGraph(sandbox: Sandbox) {
    const writerNode = createWriterNode(sandbox);

    const graph = new StateGraph(OrchestratorState)
        .addNode("coder", coderNode)
        .addNode("writer", writerNode, { defer: true })
        .addEdge(START, "coder")
        .addConditionalEdges("coder", assignWriters, ["writer"])
        .addEdge("writer", END);

    return graph.compile();
}

export interface WorkerEvent {
    type: 'generating' | 'files_ready' | 'file_writing' | 'file_written' | 'done' | 'error' | 'plan';
    file?: string;
    files?: FileContent[];
    success?: boolean;
    error?: string;
    message?: string;
    plan?: Plan;
}

export async function runMultiAgentOrchestrator(
    sandbox: Sandbox,
    userPrompt: string,
    systemPrompt: string = INITIAL_SYSTEM_PROMPT
): Promise<{
    files: FileContent[];
    writtenFiles: string[];
}> {
    log.orchestrator('Starting Code Generation');
    log.orchestrator('System prompt type:', systemPrompt === INITIAL_SYSTEM_PROMPT ? 'INITIAL' : 'CONTEXT');

    const graph = createOrchestratorGraph(sandbox);
    const result = await graph.invoke({ userPrompt, systemPrompt });

    log.orchestrator('Code Generation Complete');

    return {
        files: result.files,
        writtenFiles: result.writtenFiles
    };
}

export async function* streamMultiAgentOrchestrator(
    sandbox: Sandbox,
    userPrompt: string,
    systemPrompt: string = INITIAL_SYSTEM_PROMPT
): AsyncGenerator<WorkerEvent> {
    log.orchestrator('Starting Code Generation');
    log.orchestrator('System prompt type:', systemPrompt === INITIAL_SYSTEM_PROMPT ? 'INITIAL' : 'CONTEXT');

    const graph = createOrchestratorGraph(sandbox);

    yield { type: 'generating', message: 'Generating code...' };

    try {
        const stream = graph.streamEvents(
            { userPrompt, systemPrompt },
            { version: "v2" }
        );

        let files: FileContent[] = [];
        const emittedWriteStarts = new Set<string>();
        const emittedWriteCompletes = new Set<string>();

        for await (const event of stream) {
            if (event.event === "on_chain_end") {
                if (event.name === "coder" && event.data?.output?.files) {
                    files = event.data.output.files as FileContent[];
                    yield { type: 'files_ready', files };

                    for (const file of files) {
                        if (!emittedWriteStarts.has(file.filePath)) {
                            emittedWriteStarts.add(file.filePath);
                            yield { type: 'file_writing', file: file.filePath };
                        }
                    }
                }

                if (event.name === "writer" && event.data?.output?.writtenFiles) {
                    const written = event.data.output.writtenFiles as string[];
                    for (const filePath of written) {
                        if (!emittedWriteCompletes.has(filePath)) {
                            emittedWriteCompletes.add(filePath);
                            yield { type: 'file_written', file: filePath, success: true };
                        }
                    }
                }
            }
        }

        log.orchestrator('Code Generation Complete');
        yield { type: 'done' };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.orchestrator(`Error: ${errorMessage}`);
        yield { type: 'error', error: errorMessage, message: 'Code generation failed' };
    }
}

export { createAgentGraph, type AgentGraph, streamAgentResponse, runAgent } from "./graph";
