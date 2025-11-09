'use client'

import { useState, useEffect, useRef, useCallback } from "react";
import InputBox from "./inputbox";
import MarkdownRenderer from "./markdown-render";

interface Message {
    content: string;
    type: 'user' | 'response';
}

interface ChatBarProps {
    streamState: {
        data: string;
        isStreaming: boolean;
        error: string | null;
        sandboxUrl: string | null;
        startStream: (prompt: string, backendUrl?: string) => Promise<void>;
        stopStream: () => void;
        resetStream: () => void;
    };
    initialPrompt?: string | null;
}

export default function ChatBar({ streamState, initialPrompt }: ChatBarProps){
    const [messages, setMessages] = useState<Message[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { data, isStreaming, error, startStream, resetStream } = streamState;
    const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
    const wasStreamingRef = useRef(false);
    const shouldSaveMessageRef = useRef(false);
    const hasProcessedInitialPrompt = useRef(false);

    const handleSendMessage = useCallback(async (message: string) => {
        setMessages((prev) => [
            ...prev, 
            { content: message, type: 'user' }
        ]);

        setIsWaitingForResponse(true);
        shouldSaveMessageRef.current = true;

        try {
            await startStream(message);
            setIsWaitingForResponse(false);
        } catch (err) {
            console.error('Error starting stream:', err);
            setIsWaitingForResponse(false);
            shouldSaveMessageRef.current = false;
        }
    }, [startStream]);

    useEffect(() => {
        if (initialPrompt && !hasProcessedInitialPrompt.current) {
            hasProcessedInitialPrompt.current = true;
            setTimeout(() => {
                handleSendMessage(initialPrompt);
            }, 0);
        }
    }, [initialPrompt, handleSendMessage]);


    useEffect(() => {
        // If we were streaming and now we're not, save the response
        if (wasStreamingRef.current && !isStreaming && data && shouldSaveMessageRef.current) {
            shouldSaveMessageRef.current = false;
            
            // Use queueMicrotask to avoid the cascading render warning
            queueMicrotask(() => {
                setMessages((prev) => [
                    ...prev,
                    { content: data, type: 'response' }
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
            <div className="grow overflow-auto p-4 space-y-4">
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
                                <MarkdownRenderer markdown={message.content} />
                            </div>
                        </div>
                    )
                ))}
                
                {/* Show streaming response in real-time */}
                {(isStreaming || isWaitingForResponse) && (
                    <div className="flex justify-start">
                        <div className="text-gray-300 p-4 max-w-[80%]">
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

                {/* Show error if exists */}
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