"use client";

import { useState, useEffect, useCallback } from "react";
import { BackendUrl } from "@/config";

export interface Project {
    id: string;
    name: string;
    description: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
}

export function useProjects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchProjects = useCallback(async () => {
        try {
            setLoading(true);
            const token = localStorage.getItem("auth_token");

            if (!token) {
                setProjects([]);
                setLoading(false);
                return;
            }

            const response = await fetch(`${BackendUrl}/project`, {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });

            // Handle auth errors gracefully - don't throw, just return empty projects
            if (response.status === 401 || response.status === 403) {
                setProjects([]);
                setLoading(false);
                return;
            }

            if (!response.ok) {
                throw new Error("Failed to fetch projects");
            }

            const data = await response.json();
            setProjects(data);
            setError(null);
        } catch (err) {
            console.error("Error fetching projects:", err);
            setError(err instanceof Error ? err.message : "Failed to fetch projects");
        } finally {
            setLoading(false);
        }
    }, []);

    const deleteProject = useCallback(async (projectId: string) => {
        try {
            const token = localStorage.getItem("auth_token");
            if (!token) {
                throw new Error("Not authenticated");
            }

            const response = await fetch(`${BackendUrl}/project/${projectId}`, {
                method: "DELETE",
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error("Failed to delete project");
            }

            // Optimistically remove from local state
            setProjects(prev => prev.filter(p => p.id !== projectId));
            return true;
        } catch (err) {
            console.error("Error deleting project:", err);
            throw err;
        }
    }, []);

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    return { projects, loading, error, refetch: fetchProjects, deleteProject };
}
