"use client";
import { BackendUrl } from "@/config";
import { useState, useRef, useCallback } from "react";

interface StreamEvent {
    type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'plan' | 'worker_start' | 'worker_complete' | 'review_start' | 'review_complete';
    content?: string;
    name?: string;
    args?: Record<string, unknown>;
    message?: string;
    sandboxUrl?: string;
    sandboxId?: string;
    taskId?: number;
    file?: string;
    success?: boolean;
    plan?: {
        summary: string;
        tasks: Array<{ id: number; file: string; action: string; description: string }>;
    };
    review?: {
        status: string;
        message?: string;
        problems?: string[];
    };
}

interface ToolCall {
    name: string;
    args: Record<string, unknown>;
}

export interface FileChange {
    action: 'create' | 'update' | 'delete';
    path: string;
    content?: string;
}

export function useStream() {
    const [data, setData] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
    const [sandboxId, setSandboxId] = useState<string | null>(null);
    const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
    const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
    const abortController = useRef<AbortController | null>(null);

    if(!BackendUrl){
        console.log("BACKEND_URL is not set in .env file")
    }

    const parseSSELine = (line: string): StreamEvent | null => {
        if (!line.startsWith('data: ')) return null;
        try {
            return JSON.parse(line.slice(6)) as StreamEvent;
        } catch {
            return null;
        }
    };

    const processToolCall = (name: string, args: Record<string, unknown>) => {
        const fileOps = ['createFile', 'updateFile', 'deleteFile'];
        if (fileOps.includes(name) && args.location) {
            const action = name === 'createFile' ? 'create' 
                : name === 'updateFile' ? 'update' 
                : 'delete';
            
            setFileChanges(prev => [...prev, {
                action: action as FileChange['action'],
                path: args.location as string,
                content: args.content as string | undefined
            }]);
        }
    };

    const startStream = async (prompt: string, backendUrl: string = `${BackendUrl}/prompt` || "") => {
        setIsStreaming(true);
        setData("");
        setError(null);
        setToolCalls([]);
        setFileChanges([]);

        try {
            abortController.current = new AbortController();

            const response = await fetch(backendUrl, {
                method: "POST",
                body: JSON.stringify({ prompt }),
                headers: {
                    "Content-Type": "application/json",
                },
                signal: abortController.current.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const sandboxUrlHeader = response.headers.get("X-Sandbox-URL");
            const sandboxIdHeader = response.headers.get("X-Sandbox-ID");
            
            if (sandboxUrlHeader) {
                setSandboxUrl(sandboxUrlHeader);
            } else {
                console.log('No X-Sandbox-URL header found in response');
            }

            if (sandboxIdHeader) {
                setSandboxId(sandboxIdHeader);
                console.log('Sandbox ID:', sandboxIdHeader);
            }

            if (!response.body) {
                throw new Error("No response body");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;

                    const event = parseSSELine(trimmedLine);
                    if (!event) continue;

                    switch (event.type) {
                        case 'text':
                            if (event.content) {
                                setData((prev) => prev + event.content);
                            }
                            break;
                        case 'tool_call':
                            if (event.name && event.args) {
                                setToolCalls((prev) => [...prev, { name: event.name!, args: event.args! }]);
                                processToolCall(event.name, event.args);
                                console.log('Tool call:', event.name, event.args);
                            }
                            break;
                        case 'tool_result':
                            console.log('Tool result:', event.name, event.content);
                            break;
                        case 'plan':
                            if (event.plan) {
                                console.log('Plan received:', event.plan.summary);
                            }
                            break;
                        case 'worker_start':
                            console.log('Worker started:', event.taskId, event.file);
                            break;
                        case 'worker_complete':
                            if (event.file) {
                                setFileChanges(prev => [...prev, {
                                    action: 'update',
                                    path: event.file!
                                }]);
                            }
                            console.log('Worker complete:', event.taskId, event.file, event.success);
                            break;
                        case 'review_complete':
                            console.log('Review complete:', event.review);
                            break;
                        case 'done':
                            if (event.sandboxUrl) setSandboxUrl(event.sandboxUrl);
                            if (event.sandboxId) setSandboxId(event.sandboxId);
                            break;
                        case 'error':
                            setError(event.message || 'Unknown error');
                            break;
                    }
                }
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name !== "AbortError") {
                setError(err.message || "Error during stream");
                console.error("Stream error:", err);
            } else if (err && typeof err === 'object' && 'name' in err && err.name !== "AbortError") {
                setError("Error during stream");
                console.error("Stream error:", err);
            }
        } finally {
            setIsStreaming(false);
        }
    };

    const continueStream = useCallback(async (prompt: string, existingSandboxId: string) => {
        if (!existingSandboxId) {
            setError("No sandbox ID provided");
            return;
        }

        setIsStreaming(true);
        setData("");
        setError(null);
        setToolCalls([]);
        setFileChanges([]);

        try {
            abortController.current = new AbortController();

            const response = await fetch(`${BackendUrl}/prompt/continue`, {
                method: "POST",
                body: JSON.stringify({ prompt, sandboxId: existingSandboxId }),
                headers: {
                    "Content-Type": "application/json",
                },
                signal: abortController.current.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const sandboxUrlHeader = response.headers.get("X-Sandbox-URL");
            const sandboxIdHeader = response.headers.get("X-Sandbox-ID");
            
            if (sandboxUrlHeader) setSandboxUrl(sandboxUrlHeader);
            if (sandboxIdHeader) setSandboxId(sandboxIdHeader);

            if (!response.body) {
                throw new Error("No response body");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;

                    const event = parseSSELine(trimmedLine);
                    if (!event) continue;

                    switch (event.type) {
                        case 'text':
                            if (event.content) {
                                setData((prev) => prev + event.content);
                            }
                            break;
                        case 'tool_call':
                            if (event.name && event.args) {
                                setToolCalls((prev) => [...prev, { name: event.name!, args: event.args! }]);
                                processToolCall(event.name, event.args);
                                console.log('Tool call:', event.name, event.args);
                            }
                            break;
                        case 'tool_result':
                            console.log('Tool result:', event.name, event.content);
                            break;
                        case 'worker_complete':
                            if (event.file) {
                                setFileChanges(prev => [...prev, {
                                    action: 'update',
                                    path: event.file!
                                }]);
                            }
                            break;
                        case 'done':
                            break;
                        case 'error':
                            setError(event.message || 'Unknown error');
                            break;
                    }
                }
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name !== "AbortError") {
                setError(err.message || "Error during stream");
                console.error("Stream error:", err);
            }
        } finally {
            setIsStreaming(false);
        }
    }, []);

    const stopStream = () => {
        abortController.current?.abort();
        setIsStreaming(false);
    };

    const resetStream = () => {
        setData("");
        setError(null);
        setToolCalls([]);
        setFileChanges([]);
    };

    const clearFileChanges = useCallback(() => {
        setFileChanges([]);
    }, []);

    return {
        data,
        isStreaming,
        error,
        sandboxUrl,
        sandboxId,
        toolCalls,
        fileChanges,
        startStream,
        continueStream,
        stopStream,
        resetStream,
        clearFileChanges,
    };
}
