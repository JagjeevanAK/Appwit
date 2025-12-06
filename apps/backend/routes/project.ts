import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { ProjectStatus } from "../generated/prisma/client";

const router = Router();

router.post("/", async (req: AuthRequest, res: Response) => {
    const { name, description } = req.body;
    const userId = req.userId;

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const project = await prisma.project.create({
            data: {
                name: name || "Untitled Project",
                description: description || null,
                userId,
                status: ProjectStatus.ACTIVE
            }
        });

        res.json({
            id: project.id,
            name: project.name,
            description: project.description,
            createdAt: project.createdAt
        });
    } catch (error) {
        console.error("Error creating project:", error);
        res.status(500).json({ error: "Failed to create project" });
    }
});

router.get("/", async (req: AuthRequest, res: Response) => {
    const userId = req.userId;

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const projects = await prisma.project.findMany({
            where: {
                userId,
                status: ProjectStatus.ACTIVE
            },
            orderBy: {
                updatedAt: 'desc'
            },
            select: {
                id: true,
                name: true,
                description: true,
                status: true,
                createdAt: true,
                updatedAt: true
            }
        });

        res.json(projects);
    } catch (error) {
        console.error("Error fetching projects:", error);
        res.status(500).json({ error: "Failed to fetch projects" });
    }
});

router.get("/:projectId", async (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    const userId = req.userId;

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
                chats: {
                    include: {
                        messages: {
                            orderBy: { createdAt: 'asc' },
                            select: {
                                id: true,
                                role: true,
                                content: true,
                                summary: true,
                                createdAt: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!project) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Verify project belongs to user
        if (project.userId !== userId) {
            return res.status(403).json({ error: "Forbidden" });
        }

        res.json(project);
    } catch (error) {
        console.error("Error fetching project:", error);
        res.status(500).json({ error: "Failed to fetch project" });
    }
});

// Delete (soft delete) project
router.delete("/:projectId", async (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    const userId = req.userId;

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { userId: true }
        });

        if (!project) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Verify project belongs to user
        if (project.userId !== userId) {
            return res.status(403).json({ error: "Forbidden" });
        }

        // Soft delete
        await prisma.project.update({
            where: { id: projectId },
            data: { status: ProjectStatus.DELETED }
        });

        res.json({ success: true, message: "Project deleted" });
    } catch (error) {
        console.error("Error deleting project:", error);
        res.status(500).json({ error: "Failed to delete project" });
    }
});

export default router;
