import { Router } from "express";
import {
  generateChecklist,
  generateTaskInstructions,
} from "../services/generateChecklist";

const router = Router();

// POST /api/checklist/generate-instructions
router.post("/generate-instructions", async (req, res) => {
  try {
    const taskName =
      typeof req.body?.taskName === "string" ? req.body.taskName.trim() : "";

    if (!taskName) {
      return res
        .status(400)
        .json({ error: "taskName must be a non-empty string" });
    }

    const instructions = await generateTaskInstructions(taskName);
    return res.json({ instructions });
  } catch (error) {
    console.error("Instructions generation error:", error);
    return res.status(500).json({ error: "Failed to generate instructions" });
  }
});

// POST /api/checklist/generate-single
router.post("/generate-single", async (req, res) => {
  try {
    const taskName =
      typeof req.body?.taskName === "string" ? req.body.taskName.trim() : "";

    if (!taskName) {
      return res
        .status(400)
        .json({ error: "taskName must be a non-empty string" });
    }

    const items = await generateChecklist([taskName]);
    return res.json({ items });
  } catch (error) {
    console.error("Checklist single generation error:", error);
    return res.status(500).json({ error: "Failed to generate checklist" });
  }
});

// POST /api/checklist/generate
router.post("/generate", async (req, res) => {
  try {
    const taskNames: string[] = Array.isArray(req.body?.taskNames)
      ? req.body.taskNames.map((n: any) => String(n).trim()).filter(Boolean)
      : [];

    const prompt: string | undefined =
      typeof req.body?.prompt === "string" ? req.body.prompt : undefined;

    if (taskNames.length === 0) {
      return res
        .status(400)
        .json({ error: "taskNames must be a non-empty array of strings" });
    }

    const items = await generateChecklist(taskNames, prompt);
    return res.json({ items });
  } catch (error) {
    console.error("Checklist generation error:", error);
    return res.status(500).json({ error: "Failed to generate checklist" });
  }
});

export default router;
