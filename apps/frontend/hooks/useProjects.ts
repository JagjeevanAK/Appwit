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

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    return { projects, loading, error, refetch: fetchProjects };
}
