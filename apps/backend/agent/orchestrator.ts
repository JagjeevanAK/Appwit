import { StateGraph, Annotation, START, END, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Sandbox } from "e2b";
import { INITIAL_SYSTEM_PROMPT } from "./systemPrompt";
import { CodeGenerationSchema } from "./types";
import type { FileContent, CodeGeneration } from "./types";
import { getThemeCSS } from "../data/themes";

const log = {
    codegen: (msg: string, ...args: unknown[]) => console.log(`\x1b[36m[CODEGEN]\x1b[0m ${msg}`, ...args),
    commands: (msg: string, ...args: unknown[]) => console.log(`\x1b[35m[COMMANDS]\x1b[0m ${msg}`, ...args),
    writer: (file: string, msg: string, ...args: unknown[]) => console.log(`\x1b[33m[WRITER ${file}]\x1b[0m ${msg}`, ...args),
    orchestrator: (msg: string, ...args: unknown[]) => console.log(`\x1b[32m[ORCHESTRATOR]\x1b[0m ${msg}`, ...args),
};

const createModel = () => {
    return new ChatOpenAI({
        model: "anthropic/claude-sonnet-4.5",
        configuration: {
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY,
        },
    });
};

const GraphState = Annotation.Root({
    prompt: Annotation<string>(),
    systemPrompt: Annotation<string>(),
    theme: Annotation<string | undefined>(),
    files: Annotation<FileContent[]>(),
    commands: Annotation<string[]>(),
    writtenFiles: Annotation<string[]>(),
});

type GraphStateType = typeof GraphState.State;

interface StreamConfig extends LangGraphRunnableConfig {
    configurable?: {
        streamCallback?: (event: StreamEvent) => void;
    };
}

export interface StreamEvent {
    type: 'generating' | 'file_started' | 'file_created' | 'executing' | 'stdout' | 'stderr' | 'completed' | 'error' | 'done';
    message?: string;
    filePath?: string;
}

async function coderNode(state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> {
    log.codegen('Generating code and commands...');
    log.codegen('Prompt:', state.prompt.slice(0, 100) + (state.prompt.length > 100 ? '...' : ''));

    config?.configurable?.streamCallback?.({ type: 'generating', message: 'Generating code...' });

    const startTime = Date.now();
    const structuredModel = createModel().withStructuredOutput(CodeGenerationSchema);
    const systemPromptToUse = state.systemPrompt || INITIAL_SYSTEM_PROMPT;

    let result: CodeGeneration;
    try {
        result = await structuredModel.invoke([
            new SystemMessage(systemPromptToUse),
            new HumanMessage(state.prompt)
        ]);
    } catch (error) {
        log.codegen('Structured output failed:', error);
        throw new Error('Code generation failed');
    }

    if (!result?.files?.length) {
        throw new Error('No files generated');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.codegen(`Generated ${result.files.length} files and ${result.commands?.length || 0} commands in ${duration}s`);
    result.files.forEach(f => log.codegen(`  📄 ${f.filePath}`));
    result.commands?.forEach(c => log.commands(`  ⚡ ${c}`));

    return {
        theme: result.theme,
        files: result.files,
        commands: result.commands || []
    };
}

const log_theme = (msg: string, ...args: unknown[]) => console.log(`\x1b[34m[THEME]\x1b[0m ${msg}`, ...args);

function createThemeApplicatorNode(sandbox: Sandbox) {
    return async (state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> => {
        const themeName = state.theme;

        if (!themeName) {
            log_theme('No theme specified, using default');
            return {};
        }

        log_theme(`Applying theme: ${themeName}`);
        config?.configurable?.streamCallback?.({ type: 'executing', message: `Applying theme: ${themeName}` });

        try {
            const themeCSS = getThemeCSS(themeName);

            if (!themeCSS) {
                log_theme(`Theme "${themeName}" not found, skipping`);
                return {};
            }

            // Write theme CSS directly to index.css
            await sandbox.files.write('/home/user/src/index.css', themeCSS);
            log_theme(`Theme "${themeName}" applied to index.css`);
            config?.configurable?.streamCallback?.({ type: 'completed', message: `Theme "${themeName}" applied` });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log_theme(`Error applying theme: ${errorMessage}`);
            config?.configurable?.streamCallback?.({ type: 'error', message: `Failed to apply theme` });
        }

        return {};
    };
}

function createCommandHandlerNode(sandbox: Sandbox) {
    return async (state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> => {
        const commands = state.commands || [];

        if (commands.length === 0) {
            log.commands('No commands to execute');
            return {};
        }

        log.commands(`Running ${commands.length} commands sequentially...`);

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            if (!cmd) continue;

            const cmdNum = i + 1;
            log.commands(`[${cmdNum}/${commands.length}] ${cmd}`);

            config?.configurable?.streamCallback?.({ type: 'executing', message: `Running: ${cmd}` });

            try {
                const cmdToRun = `yes | ${cmd}`;
                log.commands(`Running: ${cmdToRun}`);

                const result = await sandbox.commands.run(cmdToRun, {
                    cwd: '/home/user',
                    timeoutMs: 120_000, // 2 min timeout for npm installs
                });

                if (result.stdout) {
                    log.commands(`stdout: ${result.stdout.slice(0, 200)}`);
                    config?.configurable?.streamCallback?.({ type: 'stdout', message: result.stdout });
                }
                if (result.stderr) {
                    log.commands(`stderr: ${result.stderr.slice(0, 200)}`);
                    config?.configurable?.streamCallback?.({ type: 'stderr', message: result.stderr });
                }

                if (result.exitCode !== 0) {
                    log.commands(`Command failed with exit code ${result.exitCode}`);
                    config?.configurable?.streamCallback?.({ type: 'error', message: `Command failed: ${cmd}` });
                    // Continue with other commands even if one fails
                }

                config?.configurable?.streamCallback?.({ type: 'completed', message: `Completed: ${cmd}` });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.commands(`Command error: ${errorMessage}`);
                config?.configurable?.streamCallback?.({ type: 'error', message: `Error: ${errorMessage}` });
            }
        }

        log.commands('All commands executed');
        return { commands: [] }; // Clear commands after execution
    };
}

function createWriterNode(sandbox: Sandbox) {
    return async (state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> => {
        const { files } = state;

        if (!files || files.length === 0) {
            log.orchestrator('No files to write');
            return { writtenFiles: [] };
        }

        log.orchestrator(`Writing ${files.length} files...`);
        const writtenFiles: string[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file) continue;

            const fileNum = i + 1;
            log.writer(file.filePath, `Writing [${fileNum}/${files.length}]`);

            config?.configurable?.streamCallback?.({ type: 'file_started', filePath: file.filePath, message: `Writing ${file.filePath}...` });

            try {
                // Create directory if needed
                const dir = file.filePath.substring(0, file.filePath.lastIndexOf('/'));
                if (dir) {
                    await sandbox.commands.run(`mkdir -p ${dir}`);
                }

                // Write file
                await sandbox.files.write(file.filePath, file.content);

                log.writer(file.filePath, 'Done');
                writtenFiles.push(file.filePath);

                config?.configurable?.streamCallback?.({ type: 'file_created', filePath: file.filePath, message: `Created ${file.filePath}` });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.writer(file.filePath, `Failed: ${errorMessage}`);
                config?.configurable?.streamCallback?.({ type: 'error', message: `Failed to write ${file.filePath}` });
            }
        }

        log.orchestrator(`Written ${writtenFiles.length}/${files.length} files`);
        return { writtenFiles };
    };
}

function createGraph(sandbox: Sandbox) {
    const themeApplicator = createThemeApplicatorNode(sandbox);
    const commandHandler = createCommandHandlerNode(sandbox);
    const writer = createWriterNode(sandbox);

    const graph = new StateGraph(GraphState)
        .addNode("codegen", coderNode)
        .addNode("themeApplicator", themeApplicator)
        .addNode("commandHandler", commandHandler)
        .addNode("writer", writer)
        .addEdge(START, "codegen")
        .addEdge("codegen", "themeApplicator")
        .addEdge("themeApplicator", "commandHandler")
        .addEdge("commandHandler", "writer")
        .addEdge("writer", END);

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

    yield { type: 'generating', message: 'Starting code generation...' };

    try {
        const stream = graph.streamEvents(
            { prompt, systemPrompt, files: [], commands: [], writtenFiles: [] },
            { version: "v2" }
        );

        let files: FileContent[] = [];
        const emittedWriteStarts = new Set<string>();
        const emittedWriteCompletes = new Set<string>();

        for await (const event of stream) {
            if (event.event === "on_chain_end") {
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

// Legacy alias for backward compatibility
export const streamMultiAgentOrchestrator = streamOrchestrator;
export const runMultiAgentOrchestrator = runOrchestrator;
