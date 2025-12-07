"use client";

import { useProjects, Project } from "@/hooks/useProjects";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { useState, useEffect } from "react";

export function ProjectsList() {
    const { projects, loading, error, deleteProject } = useProjects();
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

    const handleDeleteClick = (e: React.MouseEvent, projectId: string) => {
        e.stopPropagation();
        setConfirmDeleteId(projectId);
    };

    const handleConfirmDelete = async (e: React.MouseEvent, projectId: string) => {
        e.stopPropagation();
        setDeletingId(projectId);
        try {
            await deleteProject(projectId);
        } catch (err) {
            console.error("Failed to delete project:", err);
        } finally {
            setDeletingId(null);
            setConfirmDeleteId(null);
        }
    };

    const handleCancelDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        setConfirmDeleteId(null);
    };

    return (
        <div className="w-full mt-12">
            <h2 className="text-lg font-semibold mb-4 text-white/80">Your Projects</h2>
            <div className="grid gap-3">
                {projects.slice(0, 5).map((project) => (
                    <div
                        key={project.id}
                        onClick={() => handleProjectClick(project)}
                        className="group flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 text-left cursor-pointer"
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

                            {confirmDeleteId === project.id ? (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={(e) => handleConfirmDelete(e, project.id)}
                                        disabled={deletingId === project.id}
                                        className="px-2 py-1 text-xs bg-red-500/80 hover:bg-red-500 text-white rounded transition-colors disabled:opacity-50"
                                    >
                                        {deletingId === project.id ? "..." : "Yes"}
                                    </button>
                                    <button
                                        onClick={handleCancelDelete}
                                        className="px-2 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded transition-colors"
                                    >
                                        No
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={(e) => handleDeleteClick(e, project.id)}
                                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-all"
                                    title="Delete project"
                                >
                                    <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                        />
                                    </svg>
                                </button>
                            )}

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
                    </div>
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

