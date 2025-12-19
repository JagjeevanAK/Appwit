// Lifecycle handlers - refresh, notify-leaving, status, delete

import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import { backupProject, isR2Configured, ensureR2Mounted } from "@/lib/r2";
import { activeSandboxes, SHUTDOWN_DELAY_MS } from "@/routes/session";
import { scheduleShutdown, cancelPendingShutdown } from "@/routes/shutdown";

// POST /refresh/:sandboxId
export async function handleRefresh(req: Request, res: Response) {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    const wasPending = cancelPendingShutdown(sandboxId);
    if (wasPending) {
        console.log(`[REFRESH] User returned, cancelled pending shutdown for ${sandboxId}`);
    }

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    try {
        await session.sandbox.setTimeout(200_000);
        res.json({ success: true, message: 'Sandbox timeout refreshed', cancelledShutdown: wasPending });
    } catch (error) {
        console.error('Error refreshing sandbox timeout:', error);
        res.status(500).json({ error: 'Failed to refresh sandbox timeout' });
    }
}

// POST /notify-leaving/:sandboxId
export async function handleNotifyLeaving(req: Request, res: Response) {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    console.log(`[NOTIFY-LEAVING] Received for sandbox ${sandboxId}`);

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        console.log(`[NOTIFY-LEAVING] Session not found for ${sandboxId}`);
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    const projectId = session.projectId;
    const userId = session.userId;

    console.log(`[NOTIFY-LEAVING] Project: ${projectId}, User: ${userId}`);

    if (!projectId || !userId) {
        return res.status(400).json({ error: 'Session missing projectId or userId' });
    }

    scheduleShutdown(sandboxId, projectId, userId);

    res.json({
        success: true,
        message: `Sandbox shutdown scheduled in ${SHUTDOWN_DELAY_MS / 1000} seconds`,
        scheduledShutdownAt: new Date(Date.now() + SHUTDOWN_DELAY_MS).toISOString()
    });
}

// GET /status/:projectId
export async function handleGetStatus(req: Request, res: Response) {
    const projectId = req.params.projectId;

    if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
    }

    for (const [sandboxId, session] of activeSandboxes) {
        if (session.projectId === projectId) {
            if (session.isShuttingDown || session.isBackingUp) {
                return res.json({
                    status: 'backing_up',
                    message: 'Project is being backed up...'
                });
            }
            return res.json({
                status: 'active',
                message: 'Project is active'
            });
        }
    }

    return res.json({
        status: 'ready',
        message: 'Project is ready to load'
    });
}

// DELETE /:sandboxId
export async function handleDelete(req: Request, res: Response) {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    try {
        if (session.userId && session.projectId && isR2Configured()) {
            console.log(`[DELETE] Preparing to backup project ${session.projectId}`);

            const mountReady = await ensureR2Mounted(session.sandbox);
            if (!mountReady) {
                console.error(`[DELETE] ✗ Cannot backup - R2 mount not available`);
            } else {
                console.log(`[DELETE] Backing up project ${session.projectId} before manual termination`);
                const backed = await backupProject(session.sandbox, session.userId, session.projectId);
                if (backed) {
                    const r2BackupPath = `/${session.userId}/${session.projectId}/`;
                    await prisma.project.update({
                        where: { id: session.projectId },
                        data: {
                            r2BackupPath,
                            lastBackupAt: new Date()
                        }
                    });
                    console.log(`[DELETE] ✓ Project ${session.projectId} backed up successfully`);
                } else {
                    console.error(`[DELETE] ✗ Failed to backup project ${session.projectId}`);
                }
            }
        }

        await session.sandbox.kill();
        activeSandboxes.delete(sandboxId);
        res.json({ success: true, message: 'Sandbox closed' });
    } catch (error) {
        console.error('Error closing sandbox:', error);
        res.status(500).json({ error: 'Failed to close sandbox' });
    }
}
