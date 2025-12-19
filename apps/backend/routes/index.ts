import { Router } from "express";
import promptRouter, { activeSandboxes } from "./prompt";
import filesRouter from "./files";
import signinRouter from "./signin";
import signupRouter from "./signup";
import googleRouter from "./google";
import projectRouter from "./project";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// Health check endpoint for Docker/Kubernetes
router.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.use("/auth/signin", signinRouter);
router.use("/auth/signup", signupRouter);
router.use("/auth/google", googleRouter);

router.post("/prompt/notify-leaving/:sandboxId", async (req, res) => {
    const sandboxId = req.params.sandboxId;
    console.log(`[NOTIFY-LEAVING] Received (public route) for sandbox ${sandboxId}`);

    // Forward to the main prompt router handler
    // Import the handler directly would be cleaner but for now delegate
    const session = activeSandboxes.get(sandboxId);
    if (!session) {
        console.log(`[NOTIFY-LEAVING] Session not found for ${sandboxId}`);
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    const projectId = session.projectId;
    const userId = session.userId;

    console.log(`[NOTIFY-LEAVING] Project: ${projectId}, User: ${userId}`);

    if (!projectId || !userId) {
        return res.status(400).json({ error: 'Session missing projectId or userId' });
    }

    // Import scheduleShutdown from shutdown module
    const { scheduleShutdown } = await import("./shutdown");
    await scheduleShutdown(sandboxId, projectId, userId);

    res.json({
        success: true,
        message: `Sandbox shutdown scheduled`,
    });
});

// Public route for tab visibility changes (sendBeacon can't send auth headers)
router.post("/prompt/visibility/:sandboxId", async (req, res) => {
    const sandboxId = req.params.sandboxId;
    const { isHidden } = req.body as { isHidden?: boolean };

    console.log(`[VISIBILITY] Received for sandbox ${sandboxId}, hidden: ${isHidden}`);

    const session = activeSandboxes.get(sandboxId);
    if (!session) {
        console.log(`[VISIBILITY] Session not found for ${sandboxId}`);
        return res.status(404).json({ error: 'Sandbox session not found' });
    }

    // Import and call visibility handler directly
    const { handleTabVisibilityChange } = await import("./shutdown");
    handleTabVisibilityChange(sandboxId, isHidden === true);

    res.json({ success: true });
});

// Protected routes
router.use("/project", authMiddleware, projectRouter);
router.use("/prompt", authMiddleware, promptRouter);
router.use("/", filesRouter);

export default router;
