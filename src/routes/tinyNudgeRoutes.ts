import { Router, Request, Response } from "express";
import {
  generateTinyNudge,
  TinyNudgeRequest,
} from "../services/tinyNudgeService";

const router = Router();

// POST /api/tiny-nudge/convince-me
// Body: { taskType: "reminder" | "habit", taskName: string, friction: string }
router.post("/convince-me", async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<TinyNudgeRequest>;

    if (
      (body.taskType !== "reminder" && body.taskType !== "habit") ||
      typeof body.taskName !== "string" ||
      !body.taskName.trim() ||
      typeof body.friction !== "string" ||
      !body.friction.trim()
    ) {
      res.status(400).json({
        error: "taskType, taskName, and friction are required",
      });
      return;
    }

    const requestBody: TinyNudgeRequest = {
      taskType: body.taskType,
      taskName: body.taskName.trim(),
      friction: body.friction.trim(),
    };

    const result = await generateTinyNudge(requestBody);
    res.json(result);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("[tiny-nudge/convince-me] Error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
