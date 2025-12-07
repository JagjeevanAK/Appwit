"use client"

import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from "@/components/ui/resizable"
import ChatBar from "@/components/Chatbar"
import CodeEditor from "@/components/editor"
import { useStream } from "@/hooks/useStream"
import { useParams, useRouter } from "next/navigation"
import { useSandboxHeartbeat } from "@/hooks/useSandboxHeartbeat"
import { useProject } from "@/hooks/useProject"
import { useEffect, useState, useRef } from "react"
import { BackendUrl } from "@/config"

export default function ProjectPage() {
    const params = useParams();
    const router = useRouter();
    const projectId = params.id as string;

    const { project, loading, error } = useProject(projectId);
    const streamState = useStream(projectId);
    const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
    const hasNotifiedLeaving = useRef(false);

    // Track if the initial orchestration has completed
    const [isInitialOrchestrationComplete, setIsInitialOrchestrationComplete] = useState(false);
    const hasStartedInitialStream = useRef(false);
    const hasLoadedExistingProject = useRef(false);
    const [loadingStatus, setLoadingStatus] = useState<string>("Loading project...");

    useSandboxHeartbeat(streamState.sandboxId);

    // Handle initial prompt or load existing project
    useEffect(() => {
        const pendingPrompt = localStorage.getItem('pendingPrompt');

        if (pendingPrompt) {
            // NEW project with a prompt - let ChatBar handle the streaming
            setInitialPrompt(pendingPrompt);
            localStorage.removeItem('pendingPrompt');
            hasStartedInitialStream.current = true;
            setLoadingStatus("Building your application...");
        } else if (!hasLoadedExistingProject.current && projectId && project?.r2BackupPath) {
            // EXISTING project with R2 backup - load from R2
            hasLoadedExistingProject.current = true;
            setLoadingStatus("Restoring your project...");

            const loadProject = async () => {
                try {
                    const token = localStorage.getItem('auth_token');
                    const response = await fetch(`${BackendUrl}/prompt/load/${projectId}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                        }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        console.log('[PAGE] Project loaded:', data);
                        if (data.sandboxUrl && data.sandboxId) {
                            streamState.setSandbox(data.sandboxUrl, data.sandboxId);
                        }
                    } else {
                        console.error('[PAGE] Failed to load project');
                    }
                } catch (err) {
                    console.error('[PAGE] Error loading project:', err);
                }
                setIsInitialOrchestrationComplete(true);
            };

            loadProject();
        } else if (!hasLoadedExistingProject.current && projectId && !project?.r2BackupPath) {
            // EXISTING project without R2 backup - just show the editor
            // (This is for projects that were created but user left before backup)
            hasLoadedExistingProject.current = true;
            setIsInitialOrchestrationComplete(true);
        }
    }, [projectId, project?.r2BackupPath, streamState]);

    // Mark initial orchestration as complete when streaming finishes
    useEffect(() => {
        if (hasStartedInitialStream.current && !streamState.isStreaming && streamState.sandboxUrl) {
            setIsInitialOrchestrationComplete(true);
        }
    }, [streamState.isStreaming, streamState.sandboxUrl]);

    useEffect(() => {
        const sandboxId = streamState.sandboxId;
        console.log('[PAGE] sandboxId changed:', sandboxId);

        if (!sandboxId) {
            console.log('[PAGE] No sandboxId, skipping notify-leaving setup');
            return;
        }

        console.log('[PAGE] Setting up beforeunload listener for sandbox:', sandboxId);

        const notifyLeaving = () => {
            if (hasNotifiedLeaving.current) return;
            hasNotifiedLeaving.current = true;

            const token = localStorage.getItem('auth_token');

            console.log('[PAGE] Sending notify-leaving beacon for:', sandboxId);
            navigator.sendBeacon(
                `${BackendUrl}/prompt/notify-leaving/${sandboxId}`,
                new Blob([JSON.stringify({ token })], { type: 'application/json' })
            );
            console.log('[PAGE] Notified backend about leaving project');
        };

        // Handle browser close/tab close
        window.addEventListener('beforeunload', notifyLeaving);

        return () => {
            console.log('[PAGE] Cleanup: removing beforeunload listener');
            window.removeEventListener('beforeunload', notifyLeaving);
            // Also notify on component unmount (route change within app)
            notifyLeaving();
        };
    }, [streamState.sandboxId]);

    useEffect(() => {
        if (!loading && (error || !project)) {
            router.push("/project");
        }
    }, [loading, error, project, router]);

    // Show loader while project data is loading
    if (loading) {
        return (
            <div className="h-screen w-screen bg-[#1D1D1D] flex items-center justify-center">
                <div className="text-white text-xl">Loading project...</div>
            </div>
        );
    }

    if (error || !project) {
        return null;
    }

    // Show full-page loader during initial orchestration or project loading
    if (!isInitialOrchestrationComplete) {
        return (
            <div className="h-screen w-screen bg-[#1D1D1D] flex flex-col items-center justify-center gap-6">
                {/* Loading animation */}
                <div className="relative w-20 h-20">
                    <div className="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-transparent border-t-white rounded-full animate-spin"></div>
                </div>

                {/* Status text */}
                <div className="text-center space-y-2">
                    <div className="text-white text-xl font-medium">{loadingStatus}</div>
                    <div className="text-gray-400 text-sm">This may take a moment...</div>
                </div>

                {/* Progress dots */}
                <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen bg-[#1D1D1D] flex items-center justify-center">
            <div className="relative w-[calc(100vw-20px)] h-[calc(100vh-20px)]">
                <ResizablePanelGroup direction="horizontal">
                    <ResizablePanel defaultSize={25} minSize={20}>
                        <ChatBar streamState={streamState} initialPrompt={initialPrompt} />
                    </ResizablePanel>

                    <ResizableHandle isTransparent />

                    <ResizablePanel defaultSize={75} minSize={65}>
                        <CodeEditor streamState={streamState} />
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </div>
    )
}
