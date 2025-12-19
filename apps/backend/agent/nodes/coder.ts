import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { INITIAL_SYSTEM_PROMPT, CODER_WITH_PLAN_PROMPT } from "../systemPrompts";
import { CodeGenerationSchema } from "../types";
import type { CodeGeneration, FileContent, Plan, Task } from "../types";
import { createLLM } from "../llmFactory";
import { log, type GraphStateType, type StreamConfig, type StreamEvent } from "./types";

const BATCH_SIZE = 8;  // With maxTokens: 65536, we can handle more files per batch
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a batch-specific system prompt for processing a subset of tasks
 */
function createBatchPrompt(batchTasks: Task[], batchIndex: number, totalBatches: number, originalPlan: Plan): string {
    const batchPlan = {
        ...originalPlan,
        tasks: batchTasks
    };
    const planJson = JSON.stringify(batchPlan, null, 2);

    // Add batch context to help the LLM understand this is a partial execution
    const batchContext = totalBatches > 1
        ? `\n\nBATCH CONTEXT: This is batch ${batchIndex + 1} of ${totalBatches}. Generate code ONLY for the ${batchTasks.length} tasks listed below. Other files will be generated in separate batches.\n`
        : '';

    return CODER_WITH_PLAN_PROMPT.replace('{PLAN_JSON}', planJson).replace(
        'CRITICAL: You MUST complete ALL tasks in the plan.',
        `CRITICAL: You MUST complete ALL ${batchTasks.length} tasks in this batch.${batchContext}`
    );
}

/**
 * Creates a single-file prompt for fallback processing
 */
function createSingleFilePrompt(task: Task, originalPlan: Plan): string {
    const singlePlan = {
        ...originalPlan,
        tasks: [task]
    };
    const planJson = JSON.stringify(singlePlan, null, 2);

    return CODER_WITH_PLAN_PROMPT.replace('{PLAN_JSON}', planJson).replace(
        'CRITICAL: You MUST complete ALL tasks in the plan.',
        `CRITICAL: Generate ONLY this single file. Keep your response concise.`
    );
}

/**
 * Splits tasks into batches of BATCH_SIZE
 */
function createBatches(tasks: Task[]): Task[][] {
    const batches: Task[][] = [];
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
        batches.push(tasks.slice(i, i + BATCH_SIZE));
    }
    return batches;
}

/**
 * Deduplicates commands while preserving order
 */
function deduplicateCommands(commands: string[]): string[] {
    const seen = new Set<string>();
    return commands.filter(cmd => {
        const normalized = cmd.trim().toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}

/**
 * Process a batch with retry logic
 */
async function processBatchWithRetry(
    batchTasks: Task[],
    batchIdx: number,
    totalBatches: number,
    plan: Plan,
    userPrompt: string,
    streamCallback: ((event: StreamEvent) => void) | undefined
): Promise<{ files: FileContent[]; commands: string[]; theme?: string } | null> {
    const batchNumber = batchIdx + 1;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const structuredModel = createLLM().withStructuredOutput(CodeGenerationSchema);
            const batchPrompt = createBatchPrompt(batchTasks, batchIdx, totalBatches, plan);

            if (attempt > 1) {
                log.codegen(`  Retry attempt ${attempt}/${MAX_RETRIES}...`);
                streamCallback?.({
                    type: 'generating',
                    message: `Batch ${batchNumber}/${totalBatches} retry ${attempt}...`
                });
            }

            const result = await structuredModel.invoke([
                new SystemMessage(batchPrompt),
                new HumanMessage(userPrompt)
            ]) as CodeGeneration;

            if (result?.files?.length) {
                return {
                    files: result.files,
                    commands: result.commands || [],
                    theme: result.theme
                };
            }

            log.codegen(`  Attempt ${attempt} returned no files`);
        } catch (error) {
            log.codegen(`  Attempt ${attempt} failed:`, error instanceof Error ? error.message : error);

            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * attempt; // Exponential backoff
                log.codegen(`  Waiting ${delay}ms before retry...`);
                await sleep(delay);
            }
        }
    }

    return null;
}

/**
 * Process a single file as fallback when batch processing fails
 */
async function processSingleFile(
    task: Task,
    plan: Plan,
    userPrompt: string
): Promise<{ file: FileContent; commands: string[]; theme?: string } | null> {
    log.codegen(`  Processing single file: ${task.file}`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const structuredModel = createLLM().withStructuredOutput(CodeGenerationSchema);
            const singlePrompt = createSingleFilePrompt(task, plan);

            const result = await structuredModel.invoke([
                new SystemMessage(singlePrompt),
                new HumanMessage(userPrompt)
            ]) as CodeGeneration;

            if (result?.files?.[0]) {
                return {
                    file: result.files[0],
                    commands: result.commands || [],
                    theme: result.theme
                };
            }
        } catch (error) {
            log.codegen(`    Single file attempt ${attempt} failed:`, error instanceof Error ? error.message : error);
            if (attempt < MAX_RETRIES) {
                await sleep(RETRY_DELAY_MS * attempt);
            }
        }
    }

    return null;
}

export async function coderNode(state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> {
    log.codegen('Generating code and commands...');
    log.codegen('Prompt:', state.prompt.slice(0, 100) + (state.prompt.length > 100 ? '...' : ''));

    const startTime = Date.now();
    const streamCallback = config?.configurable?.streamCallback;
    const writeFiles = config?.configurable?.writeFiles;

    // If no plan or small plan, use single-pass generation (original behavior)
    if (!state.plan || state.plan.tasks.length <= BATCH_SIZE) {
        log.codegen('Using single-pass generation (plan has ≤' + BATCH_SIZE + ' tasks)');
        return singlePassGeneration(state, streamCallback, writeFiles, startTime);
    }

    // Batch processing for larger plans
    const plan = state.plan; // Capture for type narrowing
    log.codegen(`Executing plan with ${plan.tasks.length} tasks using batch processing:`);
    plan.tasks.forEach(t => log.codegen(`  - ${t.action} ${t.file}: ${t.description}`));

    const batches = createBatches(plan.tasks);
    log.codegen(`Split into ${batches.length} batches of up to ${BATCH_SIZE} files each`);

    // Accumulate results across batches
    const allFiles: FileContent[] = [];
    const allWrittenFiles: string[] = [];
    const allCommands: string[] = [];
    const failedTasks: Task[] = [];

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batchTasks = batches[batchIdx]!;
        const batchNumber = batchIdx + 1;

        log.codegen(`\n--- Processing batch ${batchNumber}/${batches.length} (${batchTasks.length} files) ---`);
        batchTasks.forEach(t => log.codegen(`  📋 ${t.action} ${t.file}`));

        streamCallback?.({
            type: 'generating',
            message: `Generating code (batch ${batchNumber}/${batches.length})...`
        });

        // Try batch processing with retries
        const batchResult = await processBatchWithRetry(
            batchTasks,
            batchIdx,
            batches.length,
            plan,
            state.prompt,
            streamCallback
        );

        let batchFiles: FileContent[] = [];

        if (batchResult) {
            batchFiles = batchResult.files;
            allCommands.push(...batchResult.commands);

            log.codegen(`Batch ${batchNumber} generated ${batchResult.files.length} files`);
            batchResult.files.forEach(f => log.codegen(`  ✓ ${f.filePath}`));
        } else {
            // Batch failed after all retries - try processing files individually
            log.codegen(`Batch ${batchNumber} failed after ${MAX_RETRIES} retries. Falling back to single-file processing...`);

            streamCallback?.({
                type: 'generating',
                message: `Batch ${batchNumber} failed, processing files individually...`
            });

            for (const task of batchTasks) {
                const singleResult = await processSingleFile(task, plan, state.prompt);

                if (singleResult) {
                    batchFiles.push(singleResult.file);
                    allCommands.push(...singleResult.commands);
                    log.codegen(`  ✓ ${singleResult.file.filePath}`);
                } else {
                    log.codegen(`  ✗ Failed to generate: ${task.file}`);
                    failedTasks.push(task);
                }
            }
        }

        // Progressive writing: Write files immediately after each batch
        if (batchFiles.length > 0) {
            allFiles.push(...batchFiles);

            if (writeFiles) {
                log.codegen(`Writing ${batchFiles.length} files from batch ${batchNumber}...`);
                try {
                    const writtenPaths = await writeFiles(batchFiles);
                    allWrittenFiles.push(...writtenPaths);
                    log.codegen(`  ✓ Written ${writtenPaths.length} files`);
                } catch (error) {
                    log.codegen(`  ✗ Failed to write batch ${batchNumber}:`, error);
                }
            }
        }
    }

    if (allFiles.length === 0) {
        throw new Error('No files generated across all batches');
    }

    // Deduplicate commands (different batches might request same npm install)
    const uniqueCommands = deduplicateCommands(allCommands);

    // Validate that all planned tasks are covered
    const generatedPaths = new Set(allFiles.map(f => f.filePath));
    const missingTasks = plan.tasks.filter(t =>
        t.action !== 'delete' && !generatedPaths.has(t.file)
    );

    if (missingTasks.length > 0) {
        log.codegen('WARNING: Missing files from plan:');
        missingTasks.forEach(t => log.codegen(`  - ${t.file}`));
    }

    if (failedTasks.length > 0) {
        log.codegen(`WARNING: ${failedTasks.length} files failed to generate after all retries`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.codegen(`\n=== Batch processing complete ===`);
    log.codegen(`Generated ${allFiles.length} files and ${uniqueCommands.length} commands in ${duration}s across ${batches.length} batches`);
    if (writeFiles) {
        log.codegen(`Progressive writing: ${allWrittenFiles.length} files written during generation`);
    }

    // Theme is set by planner, don't override it
    return {
        files: allFiles,
        commands: uniqueCommands,
        writtenFiles: allWrittenFiles
    };
}

/**
 * Original single-pass generation for small plans or no plan (with retry logic)
 */
async function singlePassGeneration(
    state: GraphStateType,
    streamCallback: ((event: StreamEvent) => void) | undefined,
    writeFiles: ((files: FileContent[]) => Promise<string[]>) | undefined,
    startTime: number
): Promise<Partial<GraphStateType>> {
    // Log plan if available
    if (state.plan) {
        log.codegen(`Executing plan with ${state.plan.tasks.length} tasks:`);
        state.plan.tasks.forEach(t => log.codegen(`  - ${t.action} ${t.file}: ${t.description}`));
    }

    streamCallback?.({ type: 'generating', message: 'Generating code...' });

    // Build system prompt - inject plan if available
    let systemPromptToUse = state.systemPrompt || INITIAL_SYSTEM_PROMPT;

    if (state.plan && state.plan.tasks.length > 0) {
        const planJson = JSON.stringify(state.plan, null, 2);
        systemPromptToUse = CODER_WITH_PLAN_PROMPT.replace('{PLAN_JSON}', planJson);
        log.codegen('Using plan-aware prompt');
    }

    let result: CodeGeneration | null = null;
    let lastError: Error | null = null;

    // Retry loop for single-pass generation
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const structuredModel = createLLM().withStructuredOutput(CodeGenerationSchema);

            if (attempt > 1) {
                log.codegen(`Retry attempt ${attempt}/${MAX_RETRIES}...`);
                streamCallback?.({
                    type: 'generating',
                    message: `Generating code (retry ${attempt})...`
                });
            }

            result = await structuredModel.invoke([
                new SystemMessage(systemPromptToUse),
                new HumanMessage(state.prompt)
            ]) as CodeGeneration;

            if (result?.files?.length) {
                break; // Success!
            }

            log.codegen(`Attempt ${attempt} returned no files`);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            log.codegen(`Attempt ${attempt} failed:`, lastError.message);

            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * attempt;
                log.codegen(`Waiting ${delay}ms before retry...`);
                await sleep(delay);
            }
        }
    }

    if (!result?.files?.length) {
        throw lastError || new Error('No files generated after all retries');
    }

    // Progressive writing: write files immediately
    let writtenFiles: string[] = [];
    if (writeFiles) {
        log.codegen(`Writing ${result.files.length} files...`);
        try {
            writtenFiles = await writeFiles(result.files);
            log.codegen(`  ✓ Written ${writtenFiles.length} files`);
        } catch (error) {
            log.codegen(`  ✗ Failed to write files:`, error);
        }
    }

    // Validate that all planned tasks are covered
    if (state.plan) {
        const generatedPaths = new Set(result.files.map(f => f.filePath));
        const missingTasks = state.plan.tasks.filter(t =>
            t.action !== 'delete' && !generatedPaths.has(t.file)
        );

        if (missingTasks.length > 0) {
            log.codegen('WARNING: Missing files from plan:');
            missingTasks.forEach(t => log.codegen(`  - ${t.file}`));
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.codegen(`Generated ${result.files.length} files and ${result.commands?.length || 0} commands in ${duration}s`);
    result.files.forEach(f => log.codegen(`  📄 ${f.filePath}`));
    result.commands?.forEach(c => log.commands(`  ⚡ ${c}`));

    // Theme is set by planner, don't override it
    return {
        files: result.files,
        commands: result.commands || [],
        writtenFiles
    };
}
