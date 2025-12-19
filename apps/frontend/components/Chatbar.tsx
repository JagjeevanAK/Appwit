'use client'

import { useState, useEffect, useRef, useCallback } from "react";
import InputBox from "./inputbox";
import MarkdownRenderer from "./markdown-render";

interface ToolCall {
    name: string;
    args: Record<string, unknown>;
}

interface Message {
    content: string;
    type: 'user' | 'response';
    toolCalls?: ToolCall[];
}

interface ChatBarProps {
    streamState: {
        data: string;
        isStreaming: boolean;
        error: string | null;
        sandboxUrl: string | null;
        sandboxId: string | null;
        toolCalls: ToolCall[];
        startStream: (prompt: string, backendUrl?: string) => Promise<void>;
        continueStream: (prompt: string, sandboxId: string) => Promise<void>;
        stopStream: () => void;
        resetStream: () => void;
    };
    initialPrompt?: string | null;
}

export default function ChatBar({ streamState, initialPrompt }: ChatBarProps){
    const [messages, setMessages] = useState<Message[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { data, isStreaming, error, sandboxId, toolCalls, startStream, continueStream, resetStream } = streamState;
    const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
    const wasStreamingRef = useRef(false);
    const shouldSaveMessageRef = useRef(false);
    const hasProcessedInitialPrompt = useRef(false);
    const currentToolCallsRef = useRef<ToolCall[]>([]);

    useEffect(() => {
        if (isStreaming) {
            currentToolCallsRef.current = toolCalls;
        }
    }, [toolCalls, isStreaming]);

    const handleSendMessage = useCallback(async (message: string) => {
        setMessages((prev) => [
            ...prev, 
            { content: message, type: 'user' }
        ]);

        setIsWaitingForResponse(true);
        shouldSaveMessageRef.current = true;
        currentToolCallsRef.current = [];

        try {
            if (sandboxId) {
                console.log('Continuing conversation in sandbox:', sandboxId);
                await continueStream(message, sandboxId);
            } else {
                await startStream(message);
            }
            setIsWaitingForResponse(false);
        } catch (err) {
            console.error('Error starting stream:', err);
            setIsWaitingForResponse(false);
            shouldSaveMessageRef.current = false;
        }
    }, [startStream, continueStream, sandboxId]);

    useEffect(() => {
        if (initialPrompt && !hasProcessedInitialPrompt.current) {
            hasProcessedInitialPrompt.current = true;
            setTimeout(() => {
                handleSendMessage(initialPrompt);
            }, 0);
        }
    }, [initialPrompt, handleSendMessage]);


    useEffect(() => {
        if (wasStreamingRef.current && !isStreaming && data && shouldSaveMessageRef.current) {
            shouldSaveMessageRef.current = false;
            
            queueMicrotask(() => {
                setMessages((prev) => [
                    ...prev,
                    { 
                        content: data, 
                        type: 'response',
                        toolCalls: currentToolCallsRef.current.length > 0 ? [...currentToolCallsRef.current] : undefined
                    }
                ]);
                setTimeout(() => {
                    resetStream();
                }, 50);
            });
        }
        wasStreamingRef.current = isStreaming;
    }, [isStreaming, data, resetStream]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, data]);

    return (
        <div className="h-full w-full bg-[#1D1D1D] pr-2 text-white flex flex-col">
            <div className="grow overflow-auto p-4 space-y-4 min-h-[400px]">
                {messages.map((message, index) => (
                    message.type === 'user' ? (
                        <div 
                            key={index}
                            className="flex justify-end"
                        >
                            <div className="bg-[#282825] rounded-2xl p-4 text-white max-w-[80%]">
                                <MarkdownRenderer markdown={message.content} />
                            </div>
                        </div>
                    ) : (
                        <div 
                            key={index}
                            className="flex justify-start"
                        >
                            <div className="text-gray-300 p-4 max-w-[80%]">
                                {message.toolCalls && message.toolCalls.length > 0 && (
                                    <div className="mb-2 text-xs text-gray-500">
                                        <span className="font-semibold">Tools used:</span>{' '}
                                        {message.toolCalls.map((tc, i) => (
                                            <span key={i} className="inline-block bg-gray-700 rounded px-2 py-0.5 mr-1">
                                                {tc.name}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <MarkdownRenderer markdown={message.content} />
                            </div>
                        </div>
                ))
                )}
                
                {(isStreaming || isWaitingForResponse) && (
                    <div className="flex justify-start">
                        <div className="text-gray-300 p-4 max-w-[80%]">
                            {toolCalls.length > 0 && (
                                <div className="mb-2 text-xs text-gray-500">
                                    <span className="font-semibold">Tools being used:</span>{' '}
                                    {toolCalls.map((tc, i) => (
                                        <span key={i} className="inline-block bg-blue-700/50 rounded px-2 py-0.5 mr-1 animate-pulse">
                                            {tc.name}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {data ? (
                                <MarkdownRenderer markdown={data} />
                            ) : (
                                <div className="flex items-center space-x-2">
                                    <div className="animate-pulse">Generating response...</div>
                                    <div className="flex space-x-1">
                                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {error && !isStreaming && (
                    <div className="flex justify-start">
                        <div className="text-red-400 p-4 max-w-[80%] bg-red-900/20 rounded-lg">
                            Error: {error}
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>
            <div className="shrink-0 p-2">
                <InputBox onSendMessage={handleSendMessage} />
            </div>
        </div>
    )
}