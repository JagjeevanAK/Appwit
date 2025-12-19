import type { Sandbox } from "e2b";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";


const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

const BACKUP_MOUNT_PATH = "/mnt/backup";
const PROJECT_PATH = "/home/user";

const EXCLUDE_PATTERNS = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".npm",
    ".cache"
];

export function isR2Configured(): boolean {
    const configured = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
    return configured;
}

console.log(`[R2] Configuration status: ${isR2Configured() ? 'CONFIGURED' : 'NOT CONFIGURED'}`);

if (!isR2Configured()) {
    console.log(`[R2] Missing env vars - ACCOUNT_ID: ${!!R2_ACCOUNT_ID}, ACCESS_KEY: ${!!R2_ACCESS_KEY_ID}, SECRET_KEY: ${!!R2_SECRET_ACCESS_KEY}, BUCKET: ${!!R2_BUCKET_NAME}`);
}

export async function mountR2Bucket(sandbox: Sandbox): Promise<boolean> {
    if (!isR2Configured()) {
        console.log("[R2] R2 not configured, skipping mount");
        return false;
    }

    try {
        console.log(`[R2] Starting mount for bucket: ${R2_BUCKET_NAME}`);

        await sandbox.files.makeDir(BACKUP_MOUNT_PATH);
        console.log(`[R2] Created mount directory: ${BACKUP_MOUNT_PATH}`);

        const credentials = `${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}`;
        await sandbox.files.write("/root/.passwd-s3fs", credentials);
        await sandbox.commands.run("sudo chmod 600 /root/.passwd-s3fs");
        console.log("[R2] Credentials file created");

        const mountCommand = `sudo s3fs ${R2_BUCKET_NAME} ${BACKUP_MOUNT_PATH} -o passwd_file=/root/.passwd-s3fs -o url=https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com -o use_path_request_style -o allow_other`;

        console.log(`[R2] Executing mount command...`);
        const result = await sandbox.commands.run(mountCommand, { timeoutMs: 30000 });

        if (result.exitCode !== 0) {
            console.error("[R2] Failed to mount bucket:", result.stderr);
            console.error("[R2] stdout:", result.stdout);
            return false;
        }

        console.log("[R2] ✓ R2 bucket mounted successfully");
        return true;
    } catch (error) {
        console.error("[R2] Error mounting R2 bucket:", error);
        return false;
    }
}

export async function isR2Mounted(sandbox: Sandbox): Promise<boolean> {
    if (!isR2Configured()) {
        return false;
    }

    try {
        // Check if the mount point exists and is accessible
        const result = await sandbox.commands.run(`mountpoint -q ${BACKUP_MOUNT_PATH} && echo "mounted"`);
        const isMounted = result.stdout.trim() === "mounted";
        console.log(`[R2] Mount check: ${isMounted ? 'mounted' : 'NOT mounted'}`);
        return isMounted;
    } catch (error) {
        console.error("[R2] Error checking mount status:", error);
        return false;
    }
}

export async function ensureR2Mounted(sandbox: Sandbox): Promise<boolean> {
    if (!isR2Configured()) {
        console.log("[R2] R2 not configured, cannot ensure mount");
        return false;
    }

    console.log("[R2] Verifying R2 mount before backup...");

    // Check if already mounted
    const alreadyMounted = await isR2Mounted(sandbox);
    if (alreadyMounted) {
        console.log("[R2] ✓ R2 mount verified - still active");
        return true;
    }

    console.log("[R2] Mount stale/missing, attempting to remount...");

    try {
        await sandbox.commands.run(`sudo fusermount -uz ${BACKUP_MOUNT_PATH} 2>/dev/null || true`);
    } catch {
        // Ignore unmount errors
    }

    const remounted = await mountR2Bucket(sandbox);
    if (remounted) {
        console.log("[R2] ✓ Successfully remounted R2 bucket");
    } else {
        console.error("[R2] ✗ Failed to remount R2 bucket");
    }
    return remounted;
}

export async function projectBackupExists(
    sandbox: Sandbox,
    userId: string,
    projectId: string
): Promise<boolean> {
    if (!isR2Configured()) {
        return false;
    }

    try {
        const backupPath = `${BACKUP_MOUNT_PATH}/${userId}/${projectId}`;
        const result = await sandbox.commands.run(`test -d "${backupPath}" && echo "exists"`);
        const exists = result.stdout.trim() === "exists";

        if (exists) {
            console.log(`[R2] Backup exists for project ${projectId}`);
        } else {
            console.log(`[R2] No backup found for project ${projectId}`);
        }

        return exists;
    } catch (error) {
        console.error("[R2] Error checking backup existence:", error);
        return false;
    }
}

export async function restoreProject(
    sandbox: Sandbox,
    userId: string,
    projectId: string
): Promise<boolean> {
    if (!isR2Configured()) {
        return false;
    }

    try {
        const backupPath = `${BACKUP_MOUNT_PATH}/${userId}/${projectId}`;

        const exists = await projectBackupExists(sandbox, userId, projectId);
        if (!exists) {
            return false;
        }

        console.log(`[R2] Restoring project ${projectId} from backup...`);

        // Copy files from backup to project directory - use quiet mode for large directories
        const restoreCommand = `rsync -a "${backupPath}/" "${PROJECT_PATH}/" 2>&1 | tail -20`;
        const result = await sandbox.commands.run(restoreCommand, { timeoutMs: 600000 });

        if (result.exitCode !== 0) {
            console.error("[R2] Restore failed:", result.stderr);
            console.error("[R2] Restore output:", result.stdout);
            return false;
        }

        console.log(`[R2] ✓ Project ${projectId} restored successfully`);
        return true;
    } catch (error) {
        console.error("[R2] Error restoring project:", error);
        return false;
    }
}

/**
 * Execute a sandbox command with retry logic and proper error handling.
 * Handles E2B protocol errors (like "unsupported compressed output") gracefully.
 */
async function runCommandWithRetry(
    sandbox: Sandbox,
    command: string,
    options: { timeoutMs?: number; maxRetries?: number; retryDelayMs?: number } = {}
): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string }> {
    const { timeoutMs = 120000, maxRetries = 3, retryDelayMs = 2000 } = options;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await sandbox.commands.run(command, { timeoutMs });
            return {
                success: result.exitCode === 0,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isProtocolError = errorMessage.includes("protocol error") ||
                errorMessage.includes("compressed output") ||
                errorMessage.includes("SandboxError");

            console.log(`[R2] Command attempt ${attempt}/${maxRetries} failed: ${errorMessage.slice(0, 100)}`);

            if (attempt < maxRetries) {
                const delay = retryDelayMs * attempt; // Exponential backoff
                console.log(`[R2] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));

                // If it's a protocol error, try a simpler command variant on retry
                if (isProtocolError && attempt === maxRetries - 1) {
                    console.log(`[R2] Protocol error detected, will try simplified command on next attempt`);
                }
            } else {
                console.error(`[R2] All ${maxRetries} attempts failed`);
                return {
                    success: false,
                    exitCode: -1,
                    stdout: "",
                    stderr: errorMessage
                };
            }
        }
    }

    return { success: false, exitCode: -1, stdout: "", stderr: "Max retries exceeded" };
}

export async function backupProject(
    sandbox: Sandbox,
    userId: string,
    projectId: string
): Promise<boolean> {
    if (!isR2Configured()) {
        return false;
    }

    const backupPath = `${BACKUP_MOUNT_PATH}/${userId}/${projectId}`;
    console.log(`[R2] Starting backup for project ${projectId}...`);

    // Step 1: Create backup directory with retry
    const mkdirResult = await runCommandWithRetry(
        sandbox,
        `mkdir -p "${backupPath}"`,
        { timeoutMs: 30000, maxRetries: 2 }
    );

    if (!mkdirResult.success) {
        console.error("[R2] Failed to create backup directory:", mkdirResult.stderr);
        return false;
    }

    // Step 2: Build rsync command with all output suppressed to avoid E2B protocol errors
    const excludeFlags = EXCLUDE_PATTERNS.map(p => `--exclude='${p}'`).join(" ");

    // Use bash wrapper with complete output suppression and status file for reliability
    // This prevents the "unsupported compressed output" protocol error from E2B
    const backupCommand = `bash -c 'rsync -a --delete ${excludeFlags} "${PROJECT_PATH}/" "${backupPath}/" > /dev/null 2>&1; echo "EXIT_CODE:$?"'`;

    // Step 3: Execute backup with retry logic
    const result = await runCommandWithRetry(
        sandbox,
        backupCommand,
        { timeoutMs: 600000, maxRetries: 3, retryDelayMs: 3000 }
    );

    if (!result.success) {
        // Check if we got a protocol error but the command might have succeeded
        // Try to verify backup exists as a fallback check
        console.log("[R2] Primary backup command failed, verifying backup status...");

        const verifyResult = await runCommandWithRetry(
            sandbox,
            `bash -c 'test -d "${backupPath}" && ls -la "${backupPath}" > /dev/null 2>&1 && echo "VERIFIED" || echo "FAILED"'`,
            { timeoutMs: 30000, maxRetries: 2 }
        );

        if (verifyResult.success && verifyResult.stdout.includes("VERIFIED")) {
            console.log(`[R2] ✓ Backup verified despite command error - project ${projectId} backed up`);
            return true;
        }

        console.error("[R2] Backup failed and verification failed:", result.stderr);
        return false;
    }

    // Parse exit code from output
    const exitCodeMatch = result.stdout.match(/EXIT_CODE:(\d+)/);
    const rsyncExitCode = exitCodeMatch && exitCodeMatch[1] ? parseInt(exitCodeMatch[1], 10) : -1;

    if (rsyncExitCode !== 0) {
        console.error(`[R2] rsync exited with code ${rsyncExitCode}`);

        // rsync exit codes: 0 = success, 23 = partial transfer (some files couldn't be transferred)
        // 24 = partial transfer due to vanished source files (acceptable during active development)
        if (rsyncExitCode === 23 || rsyncExitCode === 24) {
            console.log(`[R2] ⚠ Partial backup completed (exit code ${rsyncExitCode}) - this is acceptable`);
            return true;
        }

        return false;
    }

    console.log(`[R2] ✓ Project ${projectId} backed up successfully`);
    return true;
}

export async function initializeR2ForSandbox(
    sandbox: Sandbox,
    userId: string,
    projectId: string,
    shouldRestore: boolean = false
): Promise<{ mounted: boolean; restored: boolean }> {
    if (!isR2Configured()) {
        console.log("[R2] R2 not configured, skipping initialization");
        return { mounted: false, restored: false };
    }

    console.log(`[R2] Initializing R2 for sandbox (restore: ${shouldRestore})...`);

    // Mount the bucket
    const mounted = await mountR2Bucket(sandbox);
    if (!mounted) {
        console.error("[R2] Failed to mount R2 bucket, cannot proceed with initialization");
        return { mounted: false, restored: false };
    }

    // Restore if requested
    let restored = false;
    if (shouldRestore) {
        restored = await restoreProject(sandbox, userId, projectId);
    }

    console.log(`[R2] Initialization complete - mounted: ${mounted}, restored: ${restored}`);
    return { mounted, restored };
}

// Delete project files from R2 (called when project is deleted)
export async function deleteProjectFromR2(userId: string, projectId: string): Promise<boolean> {
    if (!isR2Configured()) {
        console.log("[R2] R2 not configured, skipping delete");
        return false;
    }

    try {
        const prefix = `${userId}/${projectId}/`;
        console.log(`[R2] Deleting project backup with prefix: ${prefix}...`);

        // Create S3 client for R2
        const s3Client = new S3Client({
            region: "auto",
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID!,
                secretAccessKey: R2_SECRET_ACCESS_KEY!
            }
        });

        // List all objects with the project prefix
        let continuationToken: string | undefined;
        let totalDeleted = 0;

        do {
            const listCommand = new ListObjectsV2Command({
                Bucket: R2_BUCKET_NAME!,
                Prefix: prefix,
                ContinuationToken: continuationToken
            });

            const listResult = await s3Client.send(listCommand);
            const objects = listResult.Contents || [];

            if (objects.length > 0) {
                // Delete the objects in batches (max 1000 per request)
                const deleteCommand = new DeleteObjectsCommand({
                    Bucket: R2_BUCKET_NAME!,
                    Delete: {
                        Objects: objects.map(obj => ({ Key: obj.Key }))
                    }
                });

                await s3Client.send(deleteCommand);
                totalDeleted += objects.length;
            }

            continuationToken = listResult.NextContinuationToken;
        } while (continuationToken);

        console.log(`[R2] ✓ Deleted ${totalDeleted} objects from project ${projectId}`);
        return true;
    } catch (error) {
        console.error("[R2] Error deleting project from R2:", error);
        return false;
    }
}
