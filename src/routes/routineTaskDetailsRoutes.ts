import { Router, Request, Response } from "express";
import {
  fillRoutineTaskDetails,
  RoutineTaskDetailsObstacle,
  RoutineTaskDetailsRequest,
} from "../services/routineTaskDetailsService";

const router = Router();

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean);
}

function cleanObstacles(value: unknown): RoutineTaskDetailsObstacle[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const obstacle = cleanText(record.obstacle);
      if (!obstacle) return null;
      return {
        obstacle,
        solution: cleanText(record.solution),
      };
    })
    .filter((item): item is RoutineTaskDetailsObstacle => item !== null);
}

// POST /api/routine-task-details/fill
router.post("/fill", async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const context = cleanText(body.context);

    if (!context) {
      res.status(400).json({ error: "context is required" });
      return;
    }

    const triggerType = cleanText(body.triggerType);
    const requestBody: RoutineTaskDetailsRequest = {
      title: cleanText(body.title),
      description: cleanText(body.description),
      context,
      purpose: cleanText(body.purpose),
      trigger: cleanText(body.trigger),
      environment: cleanText(body.environment),
      reward: cleanText(body.reward),
      consequence: cleanText(body.consequence),
      steps: cleanTextArray(body.steps),
      supplies: cleanTextArray(body.supplies),
      obstacles: cleanObstacles(body.obstacles),
    };

    if (triggerType) {
      requestBody.triggerType = triggerType;
    }

    const result = await fillRoutineTaskDetails(requestBody);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[routine-task-details/fill] Error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
