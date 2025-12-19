// Download handler - GET /download/:sandboxId

import type { Request, Response } from "express";
import { activeSandboxes } from "@/routes/session";

export async function handleDownload(req: Request, res: Response) {
    const sandboxId = req.params.sandboxId;

    if (!sandboxId) {
        return res.status(400).json({ error: 'sandboxId is required' });
    }

    const session = activeSandboxes.get(sandboxId);

    if (!session) {
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    try {
        const { sandbox } = session;

        const excludePatterns = [
            'node_modules',
            '.git',
            '.env',
            '.env.local',
            '.env.production',
            '.e2b',
            'e2b.toml',
            '.cache',
            'dist',
            'build',
            '.next',
            '*.log',
            '.DS_Store',
            'bun.lockb',
            'package-lock.json',
            'yarn.lock'
        ];

        const excludeArgs = excludePatterns.map(p => `-x '${p}' -x '${p}/*'`).join(' ');

        const zipFileName = `project-${Date.now()}.zip`;
        const createZipCmd = `cd /home/user && zip -qr /tmp/${zipFileName} . ${excludeArgs}`;

        console.log(`[DOWNLOAD] Creating zip archive`);
        const result = await sandbox.commands.run(createZipCmd);

        if (result.exitCode !== 0) {
            console.error(`[DOWNLOAD] Failed to create zip: ${result.stderr}`);
            return res.status(500).json({ error: 'Failed to create project archive' });
        }

        const zipContent = await sandbox.files.read(`/tmp/${zipFileName}`);

        await sandbox.commands.run(`rm /tmp/${zipFileName}`);

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

        if (typeof zipContent === 'string') {
            res.send(Buffer.from(zipContent, 'binary'));
        } else {
            res.send(zipContent);
        }

        console.log(`[DOWNLOAD] Project downloaded successfully for sandbox ${sandboxId}`);
    } catch (error) {
        console.error('Error downloading project:', error);
        res.status(500).json({ error: 'Failed to download project' });
    }
}
