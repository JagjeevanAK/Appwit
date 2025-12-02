import { Router } from "express";
import promptRouter from "./prompt";
import filesRouter from "./files";

const router = Router();

router.use("/prompt", promptRouter);
router.use("/", filesRouter);

export default router;
