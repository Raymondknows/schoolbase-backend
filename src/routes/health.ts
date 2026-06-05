import { Router, Request, Response } from "express";

const router = Router();

/**
 * Health check endpoint
 * GET /api/health
 */
router.get("/", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "SchoolBase API",
    timestamp: new Date().toISOString(),
  });
});

export default router;
