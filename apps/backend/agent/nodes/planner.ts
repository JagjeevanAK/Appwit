// Planner node - analyzes requests and creates task lists

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PLANNER_SYSTEM_PROMPT } from "../systemPrompts";
import { ExtendedPlanSchema } from "../types";
import type { Plan, ExtendedPlan } from "../types";
import { createLLM } from "../llmFactory";
import { log, type GraphStateType, type StreamConfig } from "./types";

export async function plannerNode(state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> {
    log.planner('Analyzing request and creating plan...');
    log.planner('Prompt:', state.prompt.slice(0, 100) + (state.prompt.length > 100 ? '...' : ''));

    config?.configurable?.streamCallback?.({
        type: 'planning',
        message: 'Analyzing your request...'
    });

    const startTime = Date.now();
    const structuredModel = createLLM().withStructuredOutput(ExtendedPlanSchema);

    let plan: ExtendedPlan;
    try {
        plan = await structuredModel.invoke([
            new SystemMessage(PLANNER_SYSTEM_PROMPT),
            new HumanMessage(state.prompt)
        ]);
    } catch (error) {
        log.planner('Planning failed:', error);
        // Fallback to frontend-only if planning fails
        config?.configurable?.streamCallback?.({
            type: 'plan_complete',
            message: 'Using default plan (planning failed)',
        });
        return {
            plan: {
                summary: "Generating code based on request",
                tasks: [{
                    id: 1,
                    file: "/home/user/app/page.tsx",
                    action: "update" as const,
                    description: state.prompt
                }]
            },
            projectType: 'frontend-only'
        };
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.planner(`Created plan with ${plan.tasks.length} tasks in ${duration}s`);
    log.planner(`Project type: ${plan.projectType}`);
    log.planner(`Requires backend: ${plan.requiresBackend}`);
    log.planner(`Recommended theme: ${plan.recommendedTheme} (${plan.themeReason})`);
    plan.tasks.forEach(t => log.planner(`  Task ${t.id}: ${t.action} ${t.file}`));

    const planForState: Plan = {
        summary: plan.summary,
        tasks: plan.tasks
    };

    config?.configurable?.streamCallback?.({
        type: 'plan_complete',
        message: `Plan created: ${plan.tasks.length} files to ${plan.projectType === 'update' ? 'update' : 'generate'}`,
        plan: planForState
    });

    return {
        plan: planForState,
        projectType: plan.projectType,
        theme: plan.recommendedTheme  // Pass recommended theme directly to themeApplicator
    };
}
