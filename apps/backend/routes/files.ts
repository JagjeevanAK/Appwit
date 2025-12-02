import { Router } from "express";
import type { Request, Response } from "express";
import { activeSandboxes } from "./prompt";

const router = Router();

router.get("/read-file", async (req: Request, res: Response) => {
    const { sandboxId, path } = req.query;

    try {
        if (!sandboxId || typeof sandboxId !== 'string') {
            return res.status(400).json({ error: 'sandboxId is required' });
        }

        if (!path || typeof path !== 'string') {
            return res.status(400).json({ error: 'path is required' });
        }

        const sandbox = activeSandboxes.get(sandboxId);
        
        if (!sandbox) {
            return res.status(404).json({ error: 'Sandbox not found or expired' });
        }

        const content = await sandbox.files.read(path);
        
        res.json({ 
            success: true, 
            path,
            content 
        });
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({ 
            error: 'Failed to read file',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

router.get("/list-files", async (req: Request, res: Response) => {
    const { sandboxId, path = '/home/user' } = req.query;

    try {
        if (!sandboxId || typeof sandboxId !== 'string') {
            return res.status(400).json({ error: 'sandboxId is required' });
        }

        const sandbox = activeSandboxes.get(sandboxId);
        
        if (!sandbox) {
            return res.status(404).json({ error: 'Sandbox not found or expired' });
        }

        const files = await sandbox.files.list(typeof path === 'string' ? path : '/home/user');
        
        res.json({ 
            success: true, 
            path,
            files: files.map(f => ({
                name: f.name,
                type: f.type,
                path: `${path}/${f.name}`
            }))
        });
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ 
            error: 'Failed to list files',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;
