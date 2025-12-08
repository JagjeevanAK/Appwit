"use client";

import { useProjects, Project } from "@/hooks/useProjects";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { useState, useEffect, useCallback } from "react";
import { BackendUrl } from "@/config";

type ProjectStatus = 'ready' | 'backing_up' | 'active';

export function ProjectsList() {
    const { projects, loading, error, deleteProject } = useProjects();
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [projectStatuses, setProjectStatuses] = useState<Record<string, ProjectStatus>>({});

    // Prevent hydration mismatch - only render after client mount
    useEffect(() => {
        setMounted(true);
    }, []);

    // Check project statuses periodically
    const checkProjectStatuses = useCallback(async () => {
        if (!projects.length) return;

        const token = localStorage.getItem('auth_token');
        const newStatuses: Record<string, ProjectStatus> = {};

        for (const project of projects.slice(0, 5)) {
            try {
                const response = await fetch(`${BackendUrl}/prompt/status/${project.id}`, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                });
                if (response.ok) {
                    const data = await response.json();
                    newStatuses[project.id] = data.status;
                }
            } catch {
                // Ignore errors, assume ready
                newStatuses[project.id] = 'ready';
            }
        }

        setProjectStatuses(newStatuses);
    }, [projects]);

    // Check statuses on mount and periodically
    useEffect(() => {
        if (mounted && projects.length > 0) {
            checkProjectStatuses();
            const interval = setInterval(checkProjectStatuses, 5000); // Check every 5 seconds
            return () => clearInterval(interval);
        }
    }, [mounted, projects.length, checkProjectStatuses]);

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
        const status = projectStatuses[project.id];
        if (status === 'backing_up') {
            // Don't navigate - project is being backed up
            return;
        }
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
                {projects.slice(0, 5).map((project) => {
                    const status = projectStatuses[project.id];
                    const isBackingUp = status === 'backing_up';

                    return (
                        <div
                            key={project.id}
                            onClick={() => handleProjectClick(project)}
                            className={`group flex items-center justify-between p-4 rounded-xl border transition-all duration-200 text-left ${isBackingUp
                                    ? 'bg-yellow-500/10 border-yellow-500/30 cursor-wait'
                                    : 'bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20 cursor-pointer'
                                }`}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className={`font-medium truncate ${isBackingUp ? 'text-yellow-200' : 'text-white group-hover:text-white/90'}`}>
                                        {project.name}
                                    </h3>
                                    {isBackingUp && (
                                        <span className="flex items-center gap-1.5 px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-300 rounded-full">
                                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Saving...
                                        </span>
                                    )}
                                </div>
                                {project.description && (
                                    <p className={`text-sm truncate mt-0.5 ${isBackingUp ? 'text-yellow-200/60' : 'text-white/50'}`}>
                                        {project.description}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center gap-3 ml-4">
                                <span className={`text-xs ${isBackingUp ? 'text-yellow-300/60' : 'text-white/40'}`}>
                                    {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                                </span>

                                {!isBackingUp && (
                                    <>
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
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
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

