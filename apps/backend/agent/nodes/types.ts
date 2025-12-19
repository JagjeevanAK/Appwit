// Shared types and state for all orchestrator nodes

import { Annotation, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { FileContent, Plan, ReviewResult } from "../types";

// Graph state shared by all nodes
export const GraphState = Annotation.Root({
    prompt: Annotation<string>(),
    systemPrompt: Annotation<string>(),
    theme: Annotation<string | undefined>(),
    files: Annotation<FileContent[]>(),
    commands: Annotation<string[]>(),
    writtenFiles: Annotation<string[]>(),
    // Plan-related fields
    plan: Annotation<Plan | null>({
        default: () => null,
        reducer: (_, newPlan) => newPlan
    }),
    projectType: Annotation<'full-stack' | 'frontend-only' | 'api-only' | 'update'>({
        default: () => 'frontend-only',
        reducer: (_, newType) => newType
    }),
    retryCount: Annotation<number>({
        default: () => 0,
        reducer: (curr, inc) => curr + inc
    }),
    reviewResult: Annotation<ReviewResult | null>({
        default: () => null,
        reducer: (_, newResult) => newResult
    }),
});

export type GraphStateType = typeof GraphState.State;

// Stream configuration for callbacks
export interface StreamConfig extends LangGraphRunnableConfig {
    configurable?: {
        streamCallback?: (event: StreamEvent) => void;
        // Progressive writing: write files immediately after each batch
        writeFiles?: (files: FileContent[]) => Promise<string[]>;
    };
}

// Event types for streaming
export interface StreamEvent {
    type: 'planning' | 'plan_complete' | 'generating' | 'file_started' | 'file_created' | 'executing' | 'stdout' | 'stderr' | 'reviewing' | 'review_complete' | 'retrying' | 'completed' | 'error' | 'done';
    message?: string;
    filePath?: string;
    plan?: Plan;
    reviewResult?: ReviewResult;
}

// Shared loggers
export const log = {
    codegen: (msg: string, ...args: unknown[]) => console.log(`\x1b[36m[CODEGEN]\x1b[0m ${msg}`, ...args),
    commands: (msg: string, ...args: unknown[]) => console.log(`\x1b[35m[COMMANDS]\x1b[0m ${msg}`, ...args),
    writer: (file: string, msg: string, ...args: unknown[]) => console.log(`\x1b[33m[WRITER ${file}]\x1b[0m ${msg}`, ...args),
    orchestrator: (msg: string, ...args: unknown[]) => console.log(`\x1b[32m[ORCHESTRATOR]\x1b[0m ${msg}`, ...args),
    planner: (msg: string, ...args: unknown[]) => console.log(`\x1b[95m[PLANNER]\x1b[0m ${msg}`, ...args),
    reviewer: (msg: string, ...args: unknown[]) => console.log(`\x1b[91m[REVIEWER]\x1b[0m ${msg}`, ...args),
    theme: (msg: string, ...args: unknown[]) => console.log(`\x1b[34m[THEME]\x1b[0m ${msg}`, ...args),
};
