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

    useSandboxHeartbeat(streamState.sandboxId);

    useEffect(() => {
        const pendingPrompt = localStorage.getItem('pendingPrompt');
        if (pendingPrompt) {
            setInitialPrompt(pendingPrompt);
            localStorage.removeItem('pendingPrompt');
        }
    }, []);

    useEffect(() => {
        const sandboxId = streamState.sandboxId;
        if (!sandboxId) return;

        const notifyLeaving = () => {
            if (hasNotifiedLeaving.current) return;
            hasNotifiedLeaving.current = true;

            const token = localStorage.getItem('auth_token');

            navigator.sendBeacon(
                `${BackendUrl}/prompt/notify-leaving/${sandboxId}`,
                new Blob([JSON.stringify({ token })], { type: 'application/json' })
            );
            console.log('[PAGE] Notified backend about leaving project');
        };

        // Handle browser close/tab close
        window.addEventListener('beforeunload', notifyLeaving);

        return () => {
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
