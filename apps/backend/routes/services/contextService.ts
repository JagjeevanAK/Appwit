// Context service - gathers context for prompts

import type { Sandbox } from "e2b";
import { prisma } from "@/lib/prisma";
import { getRecentMessages } from "./chatService";

/**
 * Reads the main page.tsx (Next.js) or App.tsx (Vite) file from the sandbox to provide context for the LLM
 */
export async function getCurrentProjectContext(sandbox: Sandbox): Promise<string> {
    // Try Next.js page.tsx first
    try {
        const pageContent = await sandbox.files.read('/home/user/app/page.tsx');
        if (pageContent && typeof pageContent === 'string') {
            return `\n\nCURRENT page.tsx:\n\`\`\`tsx\n${pageContent}\n\`\`\``;
        }
    } catch {
        // page.tsx might not exist
    }

    // Fall back to Vite App.tsx for backward compatibility
    try {
        const appContent = await sandbox.files.read('/home/user/src/App.tsx');
        if (appContent && typeof appContent === 'string') {
            return `\n\nCURRENT App.tsx:\n\`\`\`tsx\n${appContent}\n\`\`\``;
        }
    } catch {
        // App.tsx might not exist
    }
    return '';
}

/**
 * Builds an enhanced prompt with project context, conversation history, and current code state
 */
export async function buildEnhancedPrompt(
    prompt: string,
    projectId: string | undefined,
    chatId: string | undefined,
    sandbox: Sandbox
): Promise<string> {
    let enhancedPrompt = prompt;

    // Get project description
    if (projectId) {
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { name: true, description: true }
        });
        if (project) {
            enhancedPrompt += `\n\nPROJECT: ${project.name}${project.description ? `\nDescription: ${project.description}` : ''}`;
        }
    }

    // Get conversation history
    if (chatId) {
        const messages = await getRecentMessages(chatId, 10);
        if (messages.length > 0) {
            const history = messages.reverse().map(m => ({
                role: m.role,
                content: m.summary || m.content.slice(0, 200)
            }));
            enhancedPrompt += `\n\nCONVERSATION HISTORY:\n${JSON.stringify(history, null, 2)}`;
        }
    }

    // Get current project context
    const projectContext = await getCurrentProjectContext(sandbox);
    enhancedPrompt += projectContext;

    return enhancedPrompt;
}
