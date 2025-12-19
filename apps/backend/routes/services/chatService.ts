// Chat service - database operations for chats and messages

import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { prisma } from "@/lib/prisma";
import { MessageRole } from "@/generated/prisma/client";

export async function getOrCreateChat(projectId: string): Promise<string> {
    let chat = await prisma.chat.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' }
    });

    if (!chat) {
        chat = await prisma.chat.create({
            data: { projectId }
        });
    }

    return chat.id;
}

export async function saveMessage(chatId: string, role: MessageRole, content: string, summary?: string | null) {
    await prisma.message.create({
        data: {
            chatId,
            role,
            content,
            summary: summary || undefined
        }
    });
}

export async function isFirstMessage(chatId: string): Promise<boolean> {
    const count = await prisma.message.count({
        where: { chatId }
    });
    return count === 0;
}

export async function getChatHistory(chatId: string, limit: number = 10): Promise<BaseMessage[]> {
    const messages = await prisma.message.findMany({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
            role: true,
            content: true
        }
    });

    // Reverse to get chronological order and convert to LangChain messages
    return messages.reverse().map(msg => {
        if (msg.role === MessageRole.USER) {
            return new HumanMessage(msg.content);
        } else if (msg.role === MessageRole.ASSISTANT) {
            return new AIMessage(msg.content);
        } else {
            return new SystemMessage(msg.content);
        }
    });
}

export async function getRecentMessages(chatId: string, limit: number = 10) {
    return prisma.message.findMany({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { role: true, content: true, summary: true }
    });
}
