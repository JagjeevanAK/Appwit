import { Router } from "express";
import promptRouter from "./prompt";
import filesRouter from "./files";
import signinRouter from "./signin";
import signupRouter from "./signup";
import googleRouter from "./google";
import projectRouter from "./project";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// Public routes
router.use("/auth/signin", signinRouter);
router.use("/auth/signup", signupRouter);
router.use("/auth/google", googleRouter);

// Protected routes
router.use("/project", authMiddleware, projectRouter);
router.use("/prompt", authMiddleware, promptRouter);
router.use("/", filesRouter);

export default router;
