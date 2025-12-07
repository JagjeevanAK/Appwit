import type { Sandbox } from "e2b";


const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

const BACKUP_MOUNT_PATH = "/home/user/backup";
const PROJECT_PATH = "/home/user";

const EXCLUDE_PATTERNS = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "backup"
];

export function isR2Configured(): boolean {
    return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
}

export async function mountR2Bucket(sandbox: Sandbox): Promise<boolean> {
    if (!isR2Configured()) {
        console.log("[R2] R2 not configured, skipping mount");
        return false;
    }

    try {
        await sandbox.files.makeDir(BACKUP_MOUNT_PATH);

        const credentials = `${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}`;
        await sandbox.files.write("/root/.passwd-s3fs", credentials);
        await sandbox.commands.run("sudo chmod 600 /root/.passwd-s3fs");

        const mountCommand = `sudo s3fs ${R2_BUCKET_NAME} ${BACKUP_MOUNT_PATH} -o url=https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com -o use_path_request_style -o allow_other`;

        const result = await sandbox.commands.run(mountCommand);

        if (result.exitCode !== 0) {
            console.error("[R2] Failed to mount bucket:", result.stderr);
            return false;
        }

        console.log("[R2] R2 bucket mounted successfully");
        return true;
    } catch (error) {
        console.error("[R2] Error mounting R2 bucket:", error);
        return false;
    }
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
        return result.stdout.trim() === "exists";
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
        console.log("[R2] R2 not configured, skipping restore");
        return false;
    }

    try {
        const backupPath = `${BACKUP_MOUNT_PATH}/${userId}/${projectId}`;

        // Check if backup exists
        const exists = await projectBackupExists(sandbox, userId, projectId);
        if (!exists) {
            console.log(`[R2] No backup found for project ${projectId}`);
            return false;
        }

        // Copy files from backup to project directory
        // Using rsync for efficient copying with exclusions
        const restoreCommand = `rsync -av --exclude='node_modules' "${backupPath}/" "${PROJECT_PATH}/"`;
        const result = await sandbox.commands.run(restoreCommand);

        if (result.exitCode !== 0) {
            console.error("[R2] Restore failed:", result.stderr);
            return false;
        }

        console.log(`[R2] Project ${projectId} restored successfully`);
        return true;
    } catch (error) {
        console.error("[R2] Error restoring project:", error);
        return false;
    }
}

/**
 * Backup project files from sandbox to R2
 * Called before sandbox termination
 */
export async function backupProject(
    sandbox: Sandbox,
    userId: string,
    projectId: string
): Promise<boolean> {
    if (!isR2Configured()) {
        console.log("[R2] R2 not configured, skipping backup");
        return false;
    }

    try {
        const backupPath = `${BACKUP_MOUNT_PATH}/${userId}/${projectId}`;

        // Create backup directory structure
        await sandbox.commands.run(`mkdir -p "${backupPath}"`);

        // Build exclude string for rsync
        const excludeFlags = EXCLUDE_PATTERNS.map(p => `--exclude='${p}'`).join(" ");

        // Sync project files to backup
        // Using rsync for incremental backup with deletion of removed files
        const backupCommand = `rsync -av --delete ${excludeFlags} "${PROJECT_PATH}/" "${backupPath}/"`;
        const result = await sandbox.commands.run(backupCommand);

        if (result.exitCode !== 0) {
            console.error("[R2] Backup failed:", result.stderr);
            return false;
        }

        console.log(`[R2] Project ${projectId} backed up successfully`);
        return true;
    } catch (error) {
        console.error("[R2] Error backing up project:", error);
        return false;
    }
}

/**
 * Unmount R2 bucket from sandbox
 * Called before sandbox termination for clean shutdown
 */
export async function unmountR2Bucket(sandbox: Sandbox): Promise<boolean> {
    if (!isR2Configured()) {
        return true;
    }

    try {
        const result = await sandbox.commands.run(`sudo fusermount -u ${BACKUP_MOUNT_PATH}`);

        if (result.exitCode !== 0) {
            console.warn("[R2] Unmount warning:", result.stderr);
            // Not a critical error, continue
        }

        console.log("[R2] R2 bucket unmounted");
        return true;
    } catch (error) {
        console.warn("[R2] Error unmounting R2 bucket:", error);
        return false;
    }
}

/**
 * Full backup workflow - mount, backup, unmount
 * Use this before sandbox termination
 */
export async function performFullBackup(
    sandbox: Sandbox,
    userId: string,
    projectId: string
): Promise<boolean> {
    if (!isR2Configured()) {
        return false;
    }

    const mounted = await mountR2Bucket(sandbox);
    if (!mounted) {
        return false;
    }

    const backed = await backupProject(sandbox, userId, projectId);

    await unmountR2Bucket(sandbox);

    return backed;
}

/**
 * Full restore workflow - mount, restore, keep mounted for ongoing syncs
 * Use this when sandbox starts for an existing project
 */
export async function performFullRestore(
    sandbox: Sandbox,
    userId: string,
    projectId: string
): Promise<boolean> {
    if (!isR2Configured()) {
        return false;
    }

    const mounted = await mountR2Bucket(sandbox);
    if (!mounted) {
        return false;
    }

    const restored = await restoreProject(sandbox, userId, projectId);

    return restored;
}
