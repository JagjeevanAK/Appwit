// Prompt routes - main router

import { Router } from "express";
import {
    handleInitialPrompt,
    handleContinuePrompt,
    handleGetHistory,
    handleLoadProject,
    handleRefresh,
    handleNotifyLeaving,
    handleGetStatus,
    handleDelete,
    handleDownload
} from "./handlers";

export { activeSandboxes } from "@/routes/session";

const router = Router();

// Main prompt handlers
router.post("/", handleInitialPrompt);
router.post("/continue", handleContinuePrompt);

// History
router.get("/history/:sandboxId", handleGetHistory);

// Project management
router.post("/load/:projectId", handleLoadProject);
router.get("/status/:projectId", handleGetStatus);

// Sandbox lifecycle
router.post("/refresh/:sandboxId", handleRefresh);
router.post("/notify-leaving/:sandboxId", handleNotifyLeaving);
router.delete("/:sandboxId", handleDelete);

// Download
router.get("/download/:sandboxId", handleDownload);

export default router;
