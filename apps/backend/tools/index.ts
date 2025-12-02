import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Sandbox } from "e2b";

export function createSandboxTools(sandbox: Sandbox) {
    const createFileTool = tool(
        async ({ location, content }) => {
            try {
                await sandbox.files.write(location, content || '');
                return `File created successfully at ${location}`;
            } catch (error) {
                return `Error creating file: ${error}`;
            }
        },
        {
            name: "createFile",
            description: "Create a NEW file that doesn't exist yet at a certain directory path",
            schema: z.object({
                location: z.string().describe('Absolute path to the file (e.g., /home/user/src/components/Button.tsx)'),
                content: z.string().optional().default('').describe('Content of the file')
            }),
        }
    );

    const updateFileTool = tool(
        async ({ location, content }) => {
            try {
                await sandbox.files.write(location, content);
                return `File updated successfully at ${location}`;
            } catch (error) {
                return `Error updating file: ${error}`;
            }
        },
        {
            name: "updateFile",
            description: "Update an EXISTING file at a certain directory path. Use this to modify existing files like App.tsx",
            schema: z.object({
                location: z.string().describe('Absolute path to the file to update'),
                content: z.string().describe('New content of the file'),
            }),
        }
    );

    const deleteFileTool = tool(
        async ({ location }) => {
            try {
                await sandbox.files.remove(location);
                return `File deleted successfully at ${location}`;
            } catch (error) {
                return `Error deleting file: ${error}`;
            }
        },
        {
            name: "deleteFile",
            description: "Delete a file at a certain directory path",
            schema: z.object({
                location: z.string().describe('Absolute path to the file to delete'),
            }),
        }
    );

    const readFileTool = tool(
        async ({ location }) => {
            try {
                const content = await sandbox.files.read(location);
                return content;
            } catch (error) {
                return `Error reading file: ${error}`;
            }
        },
        {
            name: "readFile",
            description: "Read the contents of a file at a certain directory path",
            schema: z.object({
                location: z.string().describe('Absolute path to the file to read'),
            }),
        }
    );

    const listFilesTool = tool(
        async ({ path }) => {
            try {
                const files = await sandbox.files.list(path);
                return `Files in ${path}:\n${files.map(f => `- ${f.name}${f.type === 'dir' ? '/' : ''}`).join('\n')}`;
            } catch (error) {
                return `Error listing files: ${error}`;
            }
        },
        {
            name: "listFiles",
            description: "List all files in a directory to see what exists",
            schema: z.object({
                path: z.string().default('/home/user').describe('Directory path to list files from'),
            }),
        }
    );

    const runCommandTool = tool(
        async ({ command }) => {
            try {
                const result = await sandbox.commands.run(command);
                return `Exit code: ${result.exitCode}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`;
            } catch (error) {
                return `Error running command: ${error}`;
            }
        },
        {
            name: "runCommand",
            description: "Run a terminal command in the sandbox environment",
            schema: z.object({
                command: z.string().describe('The command to run in the terminal'),
            }),
        }
    );

    return [createFileTool, updateFileTool, deleteFileTool, readFileTool, listFilesTool, runCommandTool];
}

export const toolDefinitions = {
    createFile: {
        name: "createFile",
        description: "Create a NEW file that doesn't exist yet at a certain directory path",
    },
    updateFile: {
        name: "updateFile", 
        description: "Update an EXISTING file at a certain directory path",
    },
    deleteFile: {
        name: "deleteFile",
        description: "Delete a file at a certain directory path",
    },
    readFile: {
        name: "readFile",
        description: "Read the contents of a file at a certain directory path",
    },
    listFiles: {
        name: "listFiles",
        description: "List all files in a directory to see what exists",
    },
    runCommand: {
        name: "runCommand",
        description: "Run a terminal command in the sandbox environment",
    },
};

