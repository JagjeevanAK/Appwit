"use client"

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { BackendUrl } from "@/config";
import { useAuth } from "@/hooks/useAuth";

export default function ProjectLanding() {
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();
    const [status, setStatus] = useState("Loading...");
    const hasCreated = useRef(false);

    useEffect(() => {
        if (authLoading) return;

        if (!user) {
            router.push("/login");
            return;
        }

        const pendingPrompt = localStorage.getItem("pendingPrompt");

        if (!pendingPrompt) {
            router.push("/");
            return;
        }

        if (hasCreated.current) return;
        hasCreated.current = true;

        createNewProject();
    }, [authLoading, user, router]);

    const extractProjectName = (prompt: string): string => {
        const actionWords = [
            'build', 'create', 'make', 'design', 'develop', 'generate',
            'write', 'code', 'implement', 'add', 'set up', 'setup'
        ];

        let name = prompt.trim();

        for (const word of actionWords) {
            const regex = new RegExp(`^${word}\\s+(me\\s+)?(a\\s+)?(an\\s+)?`, 'i');
            name = name.replace(regex, '');
        }

        name = name
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');

        if (name.length > 50) {
            name = name.substring(0, 47) + '...';
        }

        return name || 'New Project';
    };

    const createNewProject = async () => {
        try {
            setStatus("Creating project...");
            const token = localStorage.getItem("auth_token");
            const pendingPrompt = localStorage.getItem("pendingPrompt");

            if (!token) {
                router.push("/login");
                return;
            }

            const projectName = pendingPrompt
                ? extractProjectName(pendingPrompt)
                : "New Project";

            const response = await fetch(`${BackendUrl}/project`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: projectName
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("Create project failed:", response.status, errorText);

                if (response.status === 401) {
                    localStorage.removeItem("auth_token");
                    router.push("/login");
                    return;
                }

                throw new Error(`Failed to create project: ${response.status}`);
            }

            const { id } = await response.json();
            router.push(`/project/${id}`);
        } catch (error) {
            console.error("Error creating project:", error);
            setStatus("Failed to create project. Redirecting...");
            setTimeout(() => router.push("/"), 2000);
        }
    };

    if (authLoading) {
        return (
            <div className="h-screen w-screen bg-[#1D1D1D] flex items-center justify-center">
                <div className="text-white text-xl">Loading...</div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="h-screen w-screen bg-[#1D1D1D] flex items-center justify-center">
                <div className="text-white text-xl">Redirecting to login...</div>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen bg-[#1D1D1D] flex items-center justify-center">
            <div className="text-white text-xl">{status}</div>
        </div>
    );
}
