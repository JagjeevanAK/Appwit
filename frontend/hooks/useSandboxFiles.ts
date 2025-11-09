"use client";
import { useState, useCallback } from "react";
import { BackendUrl } from "@/config";

interface FileItem {
    name: string;
    type: "file" | "dir";
    path: string;
}

interface ReadFileResponse {
    success: boolean;
    path: string;
    content: string;
}

interface ListFilesResponse {
    success: boolean;
    path: string;
    files: FileItem[];
}

export function useSandboxFiles() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const baseUrl = BackendUrl || 'http://localhost:4000';

    const readFile = useCallback(async (sandboxId: string, filePath: string): Promise<string | null> => {
        if (!sandboxId) {
            setError("Sandbox ID is required");
            return null;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(
                `${baseUrl}/read-file?sandboxId=${encodeURIComponent(sandboxId)}&path=${encodeURIComponent(filePath)}`
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const data: ReadFileResponse = await response.json();
            
            if (!data.success) {
                throw new Error("Failed to read file");
            }

            console.log(`File read successfully: ${data.path}`);
            return data.content;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Error reading file";
            setError(errorMessage);
            console.error("Error reading file:", err);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [baseUrl]);

    const listFiles = useCallback(async (sandboxId: string, dirPath: string = '/home/user'): Promise<FileItem[] | null> => {
        if (!sandboxId) {
            setError("Sandbox ID is required");
            return null;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(
                `${baseUrl}/list-files?sandboxId=${encodeURIComponent(sandboxId)}&path=${encodeURIComponent(dirPath)}`
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const data: ListFilesResponse = await response.json();
            
            if (!data.success) {
                throw new Error("Failed to list files");
            }

            console.log(`Files listed successfully from: ${data.path}`, data.files);
            return data.files;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Error listing files";
            setError(errorMessage);
            console.error("Error listing files:", err);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [baseUrl]);

    return {
        readFile,
        listFiles,
        isLoading,
        error,
    };
}
