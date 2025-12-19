// Coder node - generates code following the plan

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { INITIAL_SYSTEM_PROMPT, CODER_WITH_PLAN_PROMPT } from "../systemPrompts";
import { CodeGenerationSchema } from "../types";
import type { CodeGeneration } from "../types";
import { createLLM } from "../llmFactory";
import { log, type GraphStateType, type StreamConfig } from "./types";

export async function coderNode(state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> {
    log.codegen('Generating code and commands...');
    log.codegen('Prompt:', state.prompt.slice(0, 100) + (state.prompt.length > 100 ? '...' : ''));

    // Log plan if available
    if (state.plan) {
        log.codegen(`Executing plan with ${state.plan.tasks.length} tasks:`);
        state.plan.tasks.forEach(t => log.codegen(`  - ${t.action} ${t.file}: ${t.description}`));
    }

    config?.configurable?.streamCallback?.({ type: 'generating', message: 'Generating code...' });

    const startTime = Date.now();
    const structuredModel = createLLM().withStructuredOutput(CodeGenerationSchema);

    // Build system prompt - inject plan if available
    let systemPromptToUse = state.systemPrompt || INITIAL_SYSTEM_PROMPT;

    if (state.plan && state.plan.tasks.length > 0) {
        // Use the plan-aware prompt with injected plan
        const planJson = JSON.stringify(state.plan, null, 2);
        systemPromptToUse = CODER_WITH_PLAN_PROMPT.replace('{PLAN_JSON}', planJson);
        log.codegen('Using plan-aware prompt');
    }

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

    return {
        theme: result.theme,
        files: result.files,
        commands: result.commands || []
    };
}
