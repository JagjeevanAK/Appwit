"use client";
import { BackendUrl } from "@/config";
import { useState, useRef } from "react";

export function useStream() {
    const [data, setData] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
    const [sandboxId, setSandboxId] = useState<string | null>(null);
    const abortController = useRef<AbortController | null>(null);

    if(!BackendUrl){
        console.log("BACKEND_URL is not set in .env file")
    }

    const startStream = async (prompt: string, backendUrl: string = BackendUrl || "") => {
        setIsStreaming(true);
        setData("");
        setError(null);

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

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                setData((prev) => prev + chunk);
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

    const stopStream = () => {
        abortController.current?.abort();
        setIsStreaming(false);
    };

    const resetStream = () => {
        setData("");
        setError(null);
    };

    return {
        data,
        isStreaming,
        error,
        sandboxUrl,
        sandboxId,
        startStream,
        stopStream,
        resetStream,
    };
}
