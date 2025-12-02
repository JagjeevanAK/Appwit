import { z } from "zod";
import { Sandbox } from "e2b";

export const createFile = {
    description: 'Create a file at a certain directory',
    inputSchema: z.object({
        location: z
            .string()
            .describe('Relative path to the file'),
        content: z
            .string()
            .describe('Content of the file')
            .optional()
            .default('')
    }),
    execute: async ({ location, content, sandbox }: { location: string, content?: string, sandbox: Sandbox }) => {
        try {
            await sandbox.files.write(location, content || '');
            return `File created successfully at ${location}`;
        } catch (error) {
            return `Error creating file: ${error}`;
        }
    },
};

export const updateFile = {
    description: 'Update a file at a certain directory',
    inputSchema: z.object({
        location: z.string().describe('Relative path to the file'),
        content: z.string().describe('Content of the file'),
    }),
    execute: async ({ location, content, sandbox }: { location: string, content: string, sandbox: Sandbox }) => {
        try {
            await sandbox.files.write(location, content);
            return `File updated successfully at ${location}`;
        } catch (error) {
            return `Error updating file: ${error}`;
        }
    },
};

export const deleteFile = {
    description: 'Delete a file at a certain directory',
    inputSchema: z.object({
        location: z.string().describe('Relative path to the file'),
    }),
    execute: async ({ location, sandbox }: { location: string, sandbox: Sandbox }) => {
        try {
            await sandbox.files.remove(location);
            return `File deleted successfully at ${location}`;
        } catch (error) {
            return `Error deleting file: ${error}`;
        }
    },
};

export const readFile = {
    description: 'Read a file at a certain directory',
    inputSchema: z.object({
        location: z.string().describe('Relative path to the file'),
    }),
    execute: async ({ location, sandbox }: { location: string, sandbox: Sandbox }) => {
        try {
            const content = await sandbox.files.read(location);
            return content;
        } catch (error) {
            return `Error reading file: ${error}`;
        }
    },
};

export const listFiles = {
    description: 'List all files in a directory to see what exists',
    inputSchema: z.object({
        path: z.string().describe('Directory path to list files from').default('/home/user'),
    }),
    execute: async ({ path, sandbox }: { path: string, sandbox: Sandbox }) => {
        try {
            const files = await sandbox.files.list(path);
            return `Files in ${path}:\n${files.map(f => `- ${f.name}${f.type === 'dir' ? '/' : ''}`).join('\n')}`;
        } catch (error) {
            return `Error listing files: ${error}`;
        }
    },
};
