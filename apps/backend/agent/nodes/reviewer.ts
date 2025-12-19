// Reviewer node - validates generated files against plan

import { log, type GraphStateType, type StreamConfig } from "./types";

export async function reviewerNode(state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> {
    // Skip review if no plan or already reviewed multiple times
    if (!state.plan || state.retryCount >= 2) {
        log.reviewer('Skipping review (no plan or max retries reached)');
        return {};
    }

    log.reviewer('Reviewing generated files against plan...');
    config?.configurable?.streamCallback?.({
        type: 'reviewing',
        message: 'Validating generated files...'
    });

    const writtenPaths = new Set(state.writtenFiles || []);
    const plannedPaths = state.plan.tasks
        .filter(t => t.action !== 'delete')
        .map(t => t.file);

    const missingFiles = plannedPaths.filter(p => !writtenPaths.has(p));
    const problems: string[] = [];

    // Check for missing files
    if (missingFiles.length > 0) {
        missingFiles.forEach(f => {
            const task = state.plan!.tasks.find(t => t.file === f);
            problems.push(`Missing: ${f} (${task?.description || 'unknown purpose'})`);
        });
    }

    // Check for backend routes if project requires them
    if (state.projectType === 'full-stack') {
        const hasApiRoute = state.writtenFiles?.some(f => f.includes('/api/'));
        if (!hasApiRoute) {
            problems.push('Full-stack project missing API routes');
        }

        const hasSchemaUpdate = state.writtenFiles?.some(f => f.includes('schema.ts'));
        if (!hasSchemaUpdate) {
            problems.push('Full-stack project missing database schema updates');
        }
    }

    if (problems.length === 0) {
        log.reviewer('All tasks completed successfully');
        config?.configurable?.streamCallback?.({
            type: 'review_complete',
            message: 'All planned files generated',
            reviewResult: { status: 'success', message: 'All tasks completed' }
        });
        return {
            reviewResult: { status: 'success', message: 'All tasks completed' }
        };
    }

    log.reviewer('Issues found:');
    problems.forEach(p => log.reviewer(`  - ${p}`));

    config?.configurable?.streamCallback?.({
        type: 'review_complete',
        message: `Review found ${problems.length} issues`,
        reviewResult: {
            status: 'issues',
            problems,
            suggestions: ['Consider regenerating missing files']
        }
    });

    return {
        reviewResult: {
            status: 'issues',
            problems,
            suggestions: ['Consider regenerating missing files']
        },
        retryCount: 1 // Increment retry count
    };
}

export function shouldRetry(state: GraphStateType): "codegen" | "__end__" {
    // Don't retry more than once
    if (state.retryCount >= 2) {
        log.reviewer('Max retries reached, ending');
        return "__end__";
    }

    // Retry if review found issues and we haven't retried yet
    if (state.reviewResult?.status === 'issues' && state.retryCount === 1) {
        log.reviewer('Triggering retry due to missing files');
        return "codegen";
    }

    return "__end__";
}
