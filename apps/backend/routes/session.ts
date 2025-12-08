import type { Sandbox } from "e2b";
import type { BaseMessage } from "@langchain/core/messages";
import type { Plan } from "../agent/types";

export interface SandboxSession {
    sandbox: Sandbox;
    messages: BaseMessage[];
    sandboxUrl: string;
    plan?: Plan;
    projectId?: string;
    chatId?: string;
    userId?: string;
    isStreaming?: boolean;
    isTabHidden?: boolean;
    tabHiddenSince?: Date;
    isBackingUp?: boolean;
    isShuttingDown?: boolean;  // Prevent reopening during shutdown
    createdAt: Date;            // Track sandbox creation time for 5-min minimum
}

export interface PendingShutdown {
    timeoutId: NodeJS.Timeout | null;
    scheduledAt: Date;
    projectId: string;
    userId: string;
}

export const activeSandboxes = new Map<string, SandboxSession>();
export const pendingShutdowns = new Map<string, PendingShutdown>();
export const tabHiddenTimers = new Map<string, NodeJS.Timeout>();

// Delay before starting backup when user leaves route
export const SHUTDOWN_DELAY_MS = 10 * 1000; // 10 seconds

// Minimum time sandbox must be running before tab-hidden kill
export const MIN_SANDBOX_UPTIME_MS = 5 * 60 * 1000; // 5 minutes

// Time after tab hidden before checking kill conditions
export const TAB_HIDDEN_CHECK_DELAY_MS = 10 * 1000; // 10 seconds
