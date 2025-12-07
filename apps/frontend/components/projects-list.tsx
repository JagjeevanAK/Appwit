"use client";

import { useProjects, Project } from "@/hooks/useProjects";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { useState, useEffect } from "react";

export function ProjectsList() {
    const { projects, loading, error } = useProjects();
    const router = useRouter();
    const [mounted, setMounted] = useState(false);

    // Prevent hydration mismatch - only render after client mount
    useEffect(() => {
        setMounted(true);
    }, []);

    // Return null on server and during initial client render
    if (!mounted) {
        return null;
    }

    if (loading) {
        return (
            <div className="w-full">
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white/50"></div>
                </div>
            </div>
        );
    }

    if (error) {
        return null;
    }

    if (projects.length === 0) {
        return null;
    }

    const handleProjectClick = (project: Project) => {
        router.push(`/project/${project.id}`);
    };

    return (
        <div className="w-full mt-12">
            <h2 className="text-lg font-semibold mb-4 text-white/80">Your Projects</h2>
            <div className="grid gap-3">
                {projects.slice(0, 5).map((project) => (
                    <button
                        key={project.id}
                        onClick={() => handleProjectClick(project)}
                        className="group flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 text-left"
                    >
                        <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-white truncate group-hover:text-white/90">
                                {project.name}
                            </h3>
                            {project.description && (
                                <p className="text-sm text-white/50 truncate mt-0.5">
                                    {project.description}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-3 ml-4">
                            <span className="text-xs text-white/40">
                                {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                            </span>
                            <svg
                                className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                />
                            </svg>
                        </div>
                    </button>
                ))}
            </div>
            {projects.length > 5 && (
                <button
                    onClick={() => router.push('/project')}
                    className="w-full mt-3 py-2 text-sm text-white/50 hover:text-white/70 transition-colors"
                >
                    View all {projects.length} projects →
                </button>
            )}
        </div>
    );
}
