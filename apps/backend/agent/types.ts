import { z } from "zod";

export const FileContentSchema = z.object({
    filePath: z.string().describe("Absolute path to the file, e.g. /home/user/components/Button.tsx"),
    content: z.string().describe("Complete file content"),
});

export const CodeGenerationSchema = z.object({
    theme: z.string().optional().describe("Theme name to apply: vercel, twitter, darkmatter, caffeine, claymorphism, graphite, mocha-mousse, elegant-luxury, sage-garden, amethyst-haze"),
    files: z.array(FileContentSchema).describe("Array of files to create/update with their complete content"),
    commands: z.array(z.string()).describe("Terminal commands to run before writing files (e.g., 'npx shadcn@latest add button card')"),
});

export const TaskSchema = z.object({
    id: z.number(),
    file: z.string(),
    action: z.enum(["create", "update", "delete"]),
    description: z.string(),
});

export const PlanSchema = z.object({
    summary: z.string(),
    tasks: z.array(TaskSchema),
});

export const ExtendedPlanSchema = z.object({
    projectType: z.enum(["full-stack", "frontend-only", "api-only", "update"]),
    summary: z.string(),
    requiresBackend: z.boolean(),
    tasks: z.array(TaskSchema),
});

export const ReviewResultSchema = z.object({
    status: z.enum(["success", "issues"]),
    message: z.string().optional(),
    problems: z.array(z.string()).optional(),
    suggestions: z.array(z.string()).optional(),
});

export type FileContent = z.infer<typeof FileContentSchema>;
export type CodeGeneration = z.infer<typeof CodeGenerationSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type ExtendedPlan = z.infer<typeof ExtendedPlanSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export interface WorkerResult {
    taskId: number;
    file: string;
    success: boolean;
    message: string;
}

export interface OrchestratorState {
    userPrompt: string;
    plan: Plan | null;
    workerResults: WorkerResult[];
    reviewResult: ReviewResult | null;
    finalResponse: string;
}
