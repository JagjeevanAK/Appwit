import { Sandbox } from "e2b"
import express from "express";
import cors from "cors";
import { streamText, stepCountIs } from 'ai';
import { SYSTEM_PROMPT } from "./agent/systemPrompt";
import { createFile, updateFile, deleteFile, readFile, listFiles } from "./tools";
import { openrouter } from "./agent/agent";

const app = express();
const port = process.env.PORT
const TEMPLATE_ID = process.env.TEMPLATE_ID
const SANDBOX_PORT = process.env.SANDBOX_PORT

const activeSandboxes = new Map<string, Sandbox>();

app.use(cors({
    exposedHeaders: ['X-Sandbox-URL', 'X-Sandbox-ID']
}));
app.use(express.json());

app.post("/prompt", async(req, res) => {
    const { prompt } = req.body;

    try {
        if (!TEMPLATE_ID || !SANDBOX_PORT) {
            return res.status(500).json({ error: 'TEMPLATE_ID or SANDBOX_PORT environment variable is not set' });
        }
        const sandbox = await Sandbox.create(TEMPLATE_ID);
        
        const host = sandbox.getHost(parseInt(SANDBOX_PORT));
        const sandboxUrl = `https://${host}`;
        const sandboxId = sandbox.sandboxId;
        
        activeSandboxes.set(sandboxId, sandbox);
        
        console.log(`Sandbox created: ${sandboxUrl}, ID: ${sandboxId}`);
        
        const response = await streamText({
            model: openrouter("anthropic/claude-4.5-sonnet"),
            stopWhen: stepCountIs(10),
            tools: {
                createFile: {
                    description: createFile.description,
                    inputSchema: createFile.inputSchema,
                    execute: async (args: any) => {
                        console.log('createFile tool called with args:', args);
                        const result = await createFile.execute({ ...args, sandbox });
                        console.log('createFile result:', result);
                        return result;
                    }
                },
                updateFile: {
                    description: updateFile.description,
                    inputSchema: updateFile.inputSchema,
                    execute: async (args: any) => {
                        console.log('updateFile tool called with args:', args);
                        const result = await updateFile.execute({ ...args, sandbox });
                        console.log('updateFile result:', result);
                        return result;
                    }
                },
                deleteFile: {
                    description: deleteFile.description,
                    inputSchema: deleteFile.inputSchema,
                    execute: async (args: any) => {
                        console.log('deleteFile tool called with args:', args);
                        const result = await deleteFile.execute({ ...args, sandbox });
                        console.log('deleteFile result:', result);
                        return result;
                    }
                },
                readFile: {
                    description: readFile.description,
                    inputSchema: readFile.inputSchema,
                    execute: async (args: any) => {
                        console.log('readFile tool called with args:', args);
                        const result = await readFile.execute({ ...args, sandbox });
                        console.log('readFile result:', result);
                        return result;
                    }
                },
                listFiles: {
                    description: listFiles.description,
                    inputSchema: listFiles.inputSchema,
                    execute: async (args: any) => {
                        console.log('listFiles tool called with args:', args);
                        const result = await listFiles.execute({ ...args, sandbox });
                        console.log('listFiles result:', result);
                        return result;
                    }
                }
            },
            messages: [
                {
                    role: "system",
                    content: SYSTEM_PROMPT
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            onStepFinish: ({ text, toolCalls, toolResults, finishReason, usage }) => {
                console.log('Step finished:');
                console.log('- Text:', text);
                console.log('- Tool Calls:', toolCalls.length);
                console.log('- Tool Results:', toolResults.length);
                console.log('- Finish Reason:', finishReason);
            },
            onFinish: ({ steps }) => {
                console.log('Stream finished with', steps.length, 'steps');
            }
        });

        response.pipeTextStreamToResponse(res, {
            headers: {
                'X-Sandbox-URL': sandboxUrl,
                'X-Sandbox-ID': sandboxId
            }
        });
    } catch (error) {
        console.error('Error creating sandbox:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to create sandbox' });
        }
    }
});

app.get("/read-file", async(req, res) => {
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

app.get("/list-files", async(req, res) => {
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

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});