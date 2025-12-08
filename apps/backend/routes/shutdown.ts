import { prisma } from "../lib/prisma";
import { backupProject, isR2Configured, ensureR2Mounted } from "../lib/r2";
import {
    activeSandboxes,
    pendingShutdowns,
    tabHiddenTimers,
    SHUTDOWN_DELAY_MS,
    MIN_SANDBOX_UPTIME_MS,
    TAB_HIDDEN_CHECK_DELAY_MS
} from "./session";

/**
 * Cancel any pending shutdown for the given sandbox.
 * Returns true if a shutdown was cancelled.
 */
export function cancelPendingShutdown(sandboxId: string): boolean {
    const session = activeSandboxes.get(sandboxId);
    if (session) {
        // Reset shutting down flag so project can be reopened
        session.isShuttingDown = false;
    }

    const pending = pendingShutdowns.get(sandboxId);
    if (pending) {
        if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
        }
        pendingShutdowns.delete(sandboxId);
        console.log(`[SHUTDOWN] Cancelled pending shutdown for sandbox ${sandboxId}`);
        return true;
    }

    // Also cancel any tab hidden timers
    const tabTimer = tabHiddenTimers.get(sandboxId);
    if (tabTimer) {
        clearTimeout(tabTimer);
        tabHiddenTimers.delete(sandboxId);
        console.log(`[SHUTDOWN] Cancelled tab hidden timer for sandbox ${sandboxId}`);
    }

    return false;
}

/**
 * Perform backup and update database.
 * Returns true if backup was successful.
 */
async function performBackup(sandboxId: string, projectId: string, userId: string): Promise<boolean> {
    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        console.log(`[BACKUP] Session ${sandboxId} not found (already killed?), skipping backup`);
        return false;
    }

    // Prevent double backup - if already backing up, skip
    if (session.isBackingUp) {
        console.log(`[BACKUP] Backup already in progress for ${sandboxId}, skipping duplicate`);
        return false;
    }

    if (!isR2Configured()) {
        console.log(`[BACKUP] R2 not configured, skipping backup`);
        return false;
    }

    // Mark backup as in progress
    session.isBackingUp = true;
    console.log(`[BACKUP] Starting backup for project ${projectId}...`);

    try {
        // Ensure R2 is still mounted
        const mountReady = await ensureR2Mounted(session.sandbox);
        if (!mountReady) {
            console.error(`[BACKUP] ✗ Cannot backup - R2 mount not available`);
            session.isBackingUp = false;
            return false;
        }

        // Perform backup
        const backed = await backupProject(session.sandbox, userId, projectId);

        if (backed) {
            // Update project with R2 backup path
            const r2BackupPath = `/${userId}/${projectId}/`;
            await prisma.project.update({
                where: { id: projectId },
                data: {
                    r2BackupPath,
                    lastBackupAt: new Date()
                }
            });
            console.log(`[BACKUP] ✓ Project ${projectId} backed up to ${r2BackupPath}`);
            session.isBackingUp = false;
            return true;
        } else {
            console.error(`[BACKUP] ✗ Failed to backup project ${projectId}`);
            session.isBackingUp = false;
            return false;
        }
    } catch (error) {
        console.error(`[BACKUP] Error during backup of ${projectId}:`, error);
        session.isBackingUp = false;
        return false;
    }
}

/**
 * Kill the sandbox and cleanup.
 */
async function performKill(sandboxId: string): Promise<void> {
    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        console.log(`[KILL] Session ${sandboxId} not found, skipping`);
        pendingShutdowns.delete(sandboxId);
        return;
    }

    console.log(`[KILL] Killing sandbox ${sandboxId}`);

    try {
        await session.sandbox.kill();
        console.log(`[KILL] ✓ Sandbox ${sandboxId} killed successfully`);
    } catch (error) {
        console.error(`[KILL] Error killing sandbox ${sandboxId}:`, error);
    } finally {
        activeSandboxes.delete(sandboxId);
        pendingShutdowns.delete(sandboxId);
        tabHiddenTimers.delete(sandboxId);
    }
}

/**
 * SCENARIO 1: User leaves the /project route
 * 
 * Flow:
 * 1. Set isShuttingDown = true immediately (blocks reopening)
 * 2. Wait 10 seconds
 * 3. Start backup
 * 4. After backup completes, kill container immediately
 */
export async function scheduleShutdown(sandboxId: string, projectId: string, userId: string): Promise<void> {
    // Cancel any existing pending shutdown first
    const existingPending = pendingShutdowns.get(sandboxId);
    if (existingPending?.timeoutId) {
        clearTimeout(existingPending.timeoutId);
    }

    const session = activeSandboxes.get(sandboxId);
    if (!session) {
        console.log(`[SHUTDOWN] Session ${sandboxId} not found, cannot schedule shutdown`);
        return;
    }

    // Mark as shutting down immediately - this prevents the project from being reopened
    session.isShuttingDown = true;
    console.log(`[SHUTDOWN] Marked sandbox ${sandboxId} as shutting down. Starting 10s countdown...`);

    // Schedule backup + kill after 10 seconds
    const timeoutId = setTimeout(async () => {
        console.log(`[SHUTDOWN] 10s elapsed. Starting backup for sandbox ${sandboxId}...`);

        // Check if shutdown was cancelled during the wait
        const currentSession = activeSandboxes.get(sandboxId);
        if (!currentSession || !currentSession.isShuttingDown) {
            console.log(`[SHUTDOWN] Shutdown was cancelled for ${sandboxId}, aborting.`);
            pendingShutdowns.delete(sandboxId);
            return;
        }

        // Wait for any ongoing streaming to complete
        if (currentSession.isStreaming) {
            console.log(`[SHUTDOWN] Waiting for streaming to complete...`);
            let waitTime = 0;
            const maxWait = 60000; // 1 minute max wait
            while (currentSession.isStreaming && waitTime < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                waitTime += 1000;
            }
            if (currentSession.isStreaming) {
                console.log(`[SHUTDOWN] Streaming did not complete after ${maxWait / 1000}s, proceeding anyway`);
            }
        }

        // Perform backup
        await performBackup(sandboxId, projectId, userId);

        // Kill immediately after backup
        await performKill(sandboxId);

        console.log(`[SHUTDOWN] ✓ Shutdown complete for sandbox ${sandboxId}`);
    }, SHUTDOWN_DELAY_MS);

    pendingShutdowns.set(sandboxId, {
        timeoutId,
        scheduledAt: new Date(),
        projectId,
        userId
    });

    console.log(`[SHUTDOWN] Backup + kill scheduled in ${SHUTDOWN_DELAY_MS / 1000}s for sandbox ${sandboxId}`);
}

/**
 * SCENARIO 2: User switches to different tab
 * 
 * Flow:
 * 1. When tab hidden, schedule a check after 10 seconds
 * 2. Check conditions: streaming done AND 5-min minimum uptime
 * 3. If conditions met: backup + kill
 * 4. If NOT met: reschedule check every 30s until conditions met OR tab is visible
 */
function scheduleTabHiddenCheck(sandboxId: string): void {
    // Clear any existing timer
    const existingTimer = tabHiddenTimers.get(sandboxId);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
        await checkAndKillIfConditionsMet(sandboxId);
    }, TAB_HIDDEN_CHECK_DELAY_MS);

    tabHiddenTimers.set(sandboxId, timer);
    console.log(`[VISIBILITY] Tab hidden check scheduled for ${sandboxId} in ${TAB_HIDDEN_CHECK_DELAY_MS / 1000}s`);
}

/**
 * Check if conditions are met to kill the sandbox while tab is hidden.
 * Conditions:
 * 1. Tab is still hidden
 * 2. Streaming is complete (agent not generating code)
 * 3. Sandbox has been running for at least 5 minutes
 */
async function checkAndKillIfConditionsMet(sandboxId: string): Promise<void> {
    const session = activeSandboxes.get(sandboxId);
    tabHiddenTimers.delete(sandboxId);

    if (!session) {
        console.log(`[VISIBILITY] Session ${sandboxId} not found (already killed?), skipping`);
        return;
    }

    // If already shutting down (from route leave), don't double-process
    if (session.isShuttingDown) {
        console.log(`[VISIBILITY] Shutdown already in progress for ${sandboxId}, skipping tab-hidden handler`);
        return;
    }

    // Condition 1: Tab must still be hidden
    if (!session.isTabHidden) {
        console.log(`[VISIBILITY] Tab is now visible for ${sandboxId}, cancelling shutdown`);
        return;
    }

    // Condition 2: Streaming must be complete
    if (session.isStreaming) {
        console.log(`[VISIBILITY] Streaming still running for ${sandboxId}, rescheduling check...`);
        const timer = setTimeout(async () => {
            await checkAndKillIfConditionsMet(sandboxId);
        }, 30000); // Check again in 30s
        tabHiddenTimers.set(sandboxId, timer);
        return;
    }

    // Condition 3: Sandbox must be at least 5 minutes old
    const sandboxAge = Date.now() - session.createdAt.getTime();
    if (sandboxAge < MIN_SANDBOX_UPTIME_MS) {
        const remainingMs = MIN_SANDBOX_UPTIME_MS - sandboxAge;
        console.log(`[VISIBILITY] Sandbox ${sandboxId} only ${Math.round(sandboxAge / 1000)}s old, need ${Math.round(remainingMs / 1000)}s more. Rescheduling...`);
        const timer = setTimeout(async () => {
            await checkAndKillIfConditionsMet(sandboxId);
        }, Math.min(remainingMs + 1000, 30000)); // Check when 5 min is up or in 30s, whichever is sooner
        tabHiddenTimers.set(sandboxId, timer);
        return;
    }

    // All conditions met - backup and kill
    const projectId = session.projectId;
    const userId = session.userId;

    if (projectId && userId) {
        console.log(`[VISIBILITY] All conditions met for ${sandboxId}. Tab hidden, streaming done, 5-min uptime reached. Starting backup + kill...`);

        // Mark as shutting down
        session.isShuttingDown = true;

        // Perform backup
        await performBackup(sandboxId, projectId, userId);

        // Kill
        await performKill(sandboxId);

        console.log(`[VISIBILITY] ✓ Tab-hidden shutdown complete for sandbox ${sandboxId}`);
    } else {
        console.log(`[VISIBILITY] Missing projectId or userId for ${sandboxId}, killing without backup`);
        await performKill(sandboxId);
    }
}

/**
 * Handle tab visibility change from frontend.
 */
export function handleTabVisibilityChange(sandboxId: string, isHidden: boolean): void {
    const session = activeSandboxes.get(sandboxId);
    if (!session) {
        console.log(`[VISIBILITY] Session ${sandboxId} not found`);
        return;
    }

    session.isTabHidden = isHidden;

    if (isHidden) {
        session.tabHiddenSince = new Date();
        console.log(`[VISIBILITY] Tab hidden for sandbox ${sandboxId}`);

        // Schedule check after delay
        scheduleTabHiddenCheck(sandboxId);
    } else {
        session.tabHiddenSince = undefined;
        console.log(`[VISIBILITY] Tab visible for sandbox ${sandboxId}`);

        // Cancel any pending tab hidden check
        const existingTimer = tabHiddenTimers.get(sandboxId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            tabHiddenTimers.delete(sandboxId);
            console.log(`[VISIBILITY] Cancelled pending tab hidden check for ${sandboxId}`);
        }
    }
}

/**
 * Check if a sandbox is currently shutting down (blocks reopening).
 */
export function isSandboxShuttingDown(sandboxId: string): boolean {
    const session = activeSandboxes.get(sandboxId);
    return session?.isShuttingDown ?? false;
}

/**
 * Check if a project has any sandbox currently shutting down.
 */
export function isProjectShuttingDown(projectId: string): { shutting: boolean; sandboxId?: string } {
    for (const [sandboxId, session] of activeSandboxes) {
        if (session.projectId === projectId && session.isShuttingDown) {
            return { shutting: true, sandboxId };
        }
    }
    return { shutting: false };
}
