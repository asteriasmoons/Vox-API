import { Router } from "express";
import { generateChallengeAnalysis } from "../services/generateChallengeAnalysis";

const router = Router();

// POST /api/challenge/analyze
router.post("/analyze", async (req, res) => {
  try {
    const challengeName = String(req.body?.challengeName || "").trim();
    const progress = String(req.body?.progress || "").trim();
    const daysRemaining = Number(req.body?.daysRemaining ?? 0);
    const answers: { question: string; answer: string }[] =
      req.body?.answers ?? [];

    if (!challengeName) {
      return res.status(400).json({ error: "Missing challengeName" });
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ error: "No answers provided" });
    }

    const hasEmptyAnswer = answers.some(
      (a) => !String(a.answer || "").trim()
    );

    if (hasEmptyAnswer) {
      return res.status(400).json({ error: "All questions must be answered" });
    }

    const result = await generateChallengeAnalysis({
      challengeName,
      progress,
      daysRemaining,
      answers,
    });

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Challenge analysis error:", message);
    return res
      .status(500)
      .json({ error: message || "Failed to generate analysis" });
  }
});

export default router;
