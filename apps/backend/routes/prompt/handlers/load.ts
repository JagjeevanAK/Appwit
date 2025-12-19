// Load project handler - POST /load/:projectId

import type { Response } from "express";
import { Sandbox } from "e2b";
import { prisma } from "@/lib/prisma";
import type { AuthRequest } from "@/middleware/auth";
import { initializeR2ForSandbox, isR2Configured } from "@/lib/r2";
import { activeSandboxes } from "@/routes/session";
import { cancelPendingShutdown } from "@/routes/shutdown";
import { getOrCreateChat } from "@/routes/services";

const TEMPLATE_ID = process.env.TEMPLATE_ID;
const SANDBOX_PORT = process.env.SANDBOX_PORT;

export async function handleLoadProject(req: AuthRequest, res: Response) {
    const projectId = req.params.projectId;
    const userId = req.userId;

    if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
    }

    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const project = await prisma.project.findFirst({
            where: { id: projectId, userId }
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if there's already an active sandbox for this project
        for (const [sandboxId, session] of activeSandboxes) {
            if (session.projectId === projectId) {
                console.log(`[LOAD] Found existing sandbox ${sandboxId} for project ${projectId}`);

                if (session.isShuttingDown) {
                    console.log(`[LOAD] Sandbox ${sandboxId} is shutting down, returning status to frontend`);
                    return res.status(409).json({
                        error: 'Project is being backed up',
                        status: 'backing_up',
                        message: 'Please wait while your project is being saved...'
                    });
                }

                cancelPendingShutdown(sandboxId);

                if (session.isBackingUp) {
                    console.log(`[LOAD] Backup in progress for ${sandboxId}, waiting for completion...`);
                    let waitTime = 0;
                    const maxWaitTime = 120000;
                    const pollInterval = 1000;

                    while (session.isBackingUp && waitTime < maxWaitTime) {
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                        waitTime += pollInterval;
                    }

                    if (session.isBackingUp) {
                        console.log(`[LOAD] Backup still in progress after ${maxWaitTime / 1000}s, proceeding anyway`);
                    } else {
                        console.log(`[LOAD] Backup completed, continuing with load`);
                    }
                }

                try {
                    await session.sandbox.setTimeout(15 * 60 * 1000);
                    console.log(`[LOAD] Extended sandbox timeout to 15 minutes`);
                } catch (timeoutErr) {
                    console.warn(`[LOAD] Could not extend sandbox timeout:`, timeoutErr);
                }

                return res.json({
                    sandboxId,
                    sandboxUrl: session.sandboxUrl,
                    restored: false,
                    message: 'Using existing sandbox'
                });
            }
        }

        console.log(`[LOAD] Creating new sandbox for project ${projectId}`);
        const sandbox = await Sandbox.create(TEMPLATE_ID!, {
            timeoutMs: 300_000
        });

        const host = sandbox.getHost(parseInt(SANDBOX_PORT!));
        const sandboxUrl = `https://${host}`;
        const sandboxId = sandbox.sandboxId;

        let restored = false;
        if (isR2Configured()) {
            const shouldRestore = !!project.r2BackupPath;
            console.log(`[LOAD] Initializing R2 for project ${projectId} (shouldRestore: ${shouldRestore})`);
            const result = await initializeR2ForSandbox(sandbox, userId, projectId, shouldRestore);
            restored = result.restored;
            if (result.mounted) {
                console.log(`[LOAD] R2 initialized${restored ? ', project restored from backup' : ', no backup to restore'}`);
            }

            if (restored) {
                console.log(`[LOAD] Running npm install to restore dependencies...`);
                try {
                    const npmResult = await sandbox.commands.run(
                        'cd /home/user && npm install --legacy-peer-deps 2>&1',
                        { timeoutMs: 180000 }
                    );

                    if (npmResult.exitCode === 0) {
                        console.log(`[LOAD] ✓ Dependencies installed successfully`);
                    } else {
                        console.error(`[LOAD] ✗ npm install failed with exit code ${npmResult.exitCode}`);
                        console.error(`[LOAD] stdout:`, npmResult.stdout.slice(-500));
                        console.error(`[LOAD] stderr:`, npmResult.stderr.slice(-500));
                    }
                } catch (npmError) {
                    console.error(`[LOAD] Error running npm install:`, npmError);
                }
            }
        }

        const chatId = await getOrCreateChat(projectId);

        activeSandboxes.set(sandboxId, {
            sandbox,
            messages: [],
            sandboxUrl,
            projectId,
            chatId,
            userId,
            createdAt: new Date()
        });

        console.log(`[LOAD] Sandbox ${sandboxId} ready for project ${projectId}`);

        res.json({
            sandboxId,
            sandboxUrl,
            restored,
            message: restored ? 'Project restored from backup' : 'New sandbox created'
        });
    } catch (error) {
        console.error('[LOAD] Error loading project:', error);
        res.status(500).json({ error: 'Failed to load project' });
    }
}
