import { StateGraph, Send, Annotation, START, END } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Sandbox } from "e2b";
import { CODER_PROMPT } from "./prompts";
import { CodeGenerationSchema } from "./types";
import type { FileContent, CodeGeneration } from "./types";

const log = {
    coder: (msg: string, ...args: unknown[]) => console.log(`\x1b[36m[CODER]\x1b[0m ${msg}`, ...args),
    writer: (file: string, msg: string, ...args: unknown[]) => console.log(`\x1b[33m[WRITER ${file}]\x1b[0m ${msg}`, ...args),
    orchestrator: (msg: string, ...args: unknown[]) => console.log(`\x1b[32m[ORCHESTRATOR]\x1b[0m ${msg}`, ...args),
};

const createModel = (temperature = 0) => {
    return new ChatOpenAI({
        model: "anthropic/claude-sonnet-4",
        temperature,
        configuration: {
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY,
        },
    });
};

const OrchestratorState = Annotation.Root({
    userPrompt: Annotation<string>(),
    files: Annotation<FileContent[]>(),
    writtenFiles: Annotation<string[]>({
        reducer: (curr, update) => [...curr, ...update],
        default: () => [],
    }),
    sandbox: Annotation<Sandbox>(),
});

const WriterState = Annotation.Root({
    filePath: Annotation<string>(),
    content: Annotation<string>(),
    sandbox: Annotation<Sandbox>(),
});

type OrchestratorStateType = typeof OrchestratorState.State;
type WriterStateType = typeof WriterState.State;

async function coderNode(state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> {
    log.coder('Generating code...');
    log.coder('Prompt:', state.userPrompt.slice(0, 100) + (state.userPrompt.length > 100 ? '...' : ''));
    
    const startTime = Date.now();
    const model = createModel().withStructuredOutput(CodeGenerationSchema);
    
    const result = await model.invoke([
        new SystemMessage(CODER_PROMPT),
        new HumanMessage(state.userPrompt)
    ]);
    
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
            sandbox: state.sandbox 
        });
    });
}

async function writerNode(state: WriterStateType): Promise<{ writtenFiles: string[] }> {
    const { filePath, content, sandbox } = state;
    
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
}

function createOrchestratorGraph(sandbox: Sandbox) {
    const graph = new StateGraph(OrchestratorState)
        .addNode("coder", coderNode)
        .addNode("writer", writerNode, { defer: true })
        .addEdge(START, "coder")
        .addConditionalEdges("coder", assignWriters, ["writer"])
        .addEdge("writer", END);

    return graph.compile();
}

export interface WorkerEvent {
    type: 'generating' | 'files_ready' | 'file_writing' | 'file_written' | 'done' | 'error';
    file?: string;
    files?: FileContent[];
    success?: boolean;
    error?: string;
    message?: string;
}

export async function runMultiAgentOrchestrator(
    sandbox: Sandbox,
    userPrompt: string
): Promise<{
    files: FileContent[];
    writtenFiles: string[];
}> {
    log.orchestrator('Starting Code Generation');

    const graph = createOrchestratorGraph(sandbox);
    const result = await graph.invoke({ userPrompt, sandbox });

    log.orchestrator('Code Generation Complete');

    return {
        files: result.files,
        writtenFiles: result.writtenFiles
    };
}

export async function* streamMultiAgentOrchestrator(
    sandbox: Sandbox,
    userPrompt: string
): AsyncGenerator<WorkerEvent> {
    log.orchestrator('Starting Code Generation');

    const graph = createOrchestratorGraph(sandbox);
    
    yield { type: 'generating', message: 'Generating code...' };

    try {
        const stream = graph.streamEvents(
            { userPrompt, sandbox },
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
