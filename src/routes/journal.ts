import { Router } from "express";
import { claimDailyPrompt } from "../services/claimDailyPrompt";
import { generateDailyIntention } from "../services/generateDailyIntention";
import { generateJournalPrompt } from "../services/generateJournalPrompt";
import { generateJournalAnalysis } from "../services/generateJournalAnalysis";
import {
  generateJournalReflectionPerspective,
  generateJournalReflectionQuestions,
} from "../services/generateJournalReflection";
import { DailyJournalAnalysis } from "../models/DailyJournalAnalysis";
import { chicagoDateKey } from "../utils/chicagoDateKey";

const router = Router();
const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

// POST /api/journal/prompt
router.post("/prompt", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const quota = await claimDailyPrompt(userId);

    if (!quota.allowed) {
      return res.status(429).json({
        error: "DAILY_PROMPT_LIMIT_REACHED",
        message: "You've used your 3 prompts for today.",
        remaining: quota.remaining,
        dateKey: quota.dateKey,
      });
    }

    const prompt = await generateJournalPrompt();

    return res.json({
      prompt,
      remaining: quota.remaining,
      dateKey: quota.dateKey,
    });
  } catch (error) {
    console.error("Prompt generation error:", error);
    return res.status(500).json({ error: "Failed to generate prompt" });
  }
});

// POST /api/journal/intention
router.post("/intention", async (req, res) => {
  try {
    const context = String(req.body?.context || "").trim();

    if (!context) {
      return res.status(400).json({ error: "Missing context" });
    }

    const result = await generateDailyIntention({ context });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate daily intention";
    console.error("Daily intention generation error:", message);
    return res.status(500).json({ error: message });
  }
});

// POST /api/journal/reflections/questions
router.post("/reflections/questions", async (req, res) => {
  try {
    const entryTitle = String(req.body?.entryTitle || "").trim();
    const entryContent = String(req.body?.entryContent || "").trim();

    if (!entryContent) {
      return res.status(400).json({ error: "Missing journal entry content" });
    }

    const questions = await generateJournalReflectionQuestions({
      entryTitle,
      entryContent,
    });
    return res.json({ questions });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Journal reflection question error:", message);
    return res.status(500).json({ error: message || "Failed to generate reflection questions" });
  }
});

// POST /api/journal/reflections/perspective
router.post("/reflections/perspective", async (req, res) => {
  try {
    const entryTitle = String(req.body?.entryTitle || "").trim();
    const entryContent = String(req.body?.entryContent || "").trim();
    const responses = Array.isArray(req.body?.responses)
      ? req.body.responses.map((response: unknown) => {
          const value = response && typeof response === "object"
            ? (response as Record<string, unknown>)
            : {};
          return {
            question: String(value.question || "").trim(),
            answer: String(value.answer || "").trim(),
          };
        })
      : [];

    if (!entryContent) {
      return res.status(400).json({ error: "Missing journal entry content" });
    }
    if (responses.length !== 4) {
      return res.status(400).json({ error: "Exactly four reflection questions are required" });
    }
    if (!responses.some((response) => response.answer)) {
      return res.status(400).json({ error: "Answer at least one question before requesting a perspective" });
    }

    const perspective = await generateJournalReflectionPerspective({
      entryTitle,
      entryContent,
      responses,
    });
    return res.json({ perspective });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Journal reflection perspective error:", message);
    return res.status(500).json({ error: message || "Failed to generate reflection perspective" });
  }
});

// GET /api/journal/analyze/dates
router.get("/analyze/dates", async (req, res) => {
  try {
    const userId = String(req.query?.userId || "").trim();
    const bookId = String(req.query?.bookId || "").trim();

    if (!userId || !bookId) {
      return res.status(400).json({ error: "Missing userId or bookId" });
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffKey = chicagoDateKey(cutoff);

    const records = await DailyJournalAnalysis.find(
      { userId, bookId, dateKey: { $gte: cutoffKey } },
      { dateKey: 1, _id: 0 }
    )
      .sort({ dateKey: -1 })
      .lean();

    return res.json({ dates: records.map((r) => r.dateKey) });
  } catch (error) {
    console.error("Journal dates fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch analysis dates" });
  }
});

// GET /api/journal/analyze
router.get("/analyze", async (req, res) => {
  try {
    const userId = String(req.query?.userId || "").trim();
    const bookId = String(req.query?.bookId || "").trim();

    if (!userId || !bookId) {
      return res.status(400).json({ error: "Missing userId or bookId" });
    }

    const dateKey = String(req.query?.dateKey || "").trim() || chicagoDateKey(new Date());

    const existing = await DailyJournalAnalysis.findOne({ userId, bookId, dateKey }).lean();

    if (!existing) {
      return res.json({
        exists: false,
        dateKey,
      });
    }

    return res.json({
      exists: true,
      themes: existing.themes,
      mood: existing.mood,
      reflection: existing.reflection,
      dateKey,
      cached: true,
    });
  } catch (error) {
    console.error("Journal fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch analysis" });
  }
});
// POST /api/journal/analyze
router.post("/analyze", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    const bookId = String(req.body?.bookId || "").trim();
    const entries: { title: string; body: string }[] = req.body?.entries ?? [];
    const tags: string[] = Array.isArray(req.body?.tags) ? req.body.tags : [];
    const mindfulMinutes: number = Number(req.body?.mindfulMinutes) || 0;
    const entryCount: number = Number(req.body?.entryCount) || entries.length;
    const dateKeyOverride = String(req.body?.dateKey || "").trim();

    console.log("[analyze] userId:", userId, "bookId:", bookId, "entries count:", entries.length, "dateKey:", dateKeyOverride || "(today)");
    console.log("[analyze] incoming request body bytes:", byteLength(JSON.stringify(req.body ?? {})));
    if (entries.length > 0 && entries[0]) {
      const first = entries[0] as { title: string; body: string };
      console.log("[analyze] first entry body length:", first.body?.length);
    }

    if (!userId || !bookId) {
      return res.status(400).json({ error: "Missing userId or bookId" });
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: "No entries provided" });
    }

    const dateKey = dateKeyOverride || chicagoDateKey(new Date());

    const result = await generateJournalAnalysis(entries);

    // Upsert: overwrite any existing analysis for this date
    await DailyJournalAnalysis.findOneAndUpdate(
      { userId, bookId, dateKey },
      {
        themes: result.themes,
        mood: result.mood,
        reflection: result.reflection,
        tags,
        mindfulMinutes,
        entryCount,
      },
      { upsert: true }
    );

    return res.json({
      themes: result.themes,
      mood: result.mood,
      reflection: result.reflection,
      dateKey,
      cached: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Journal analysis error:", message);
    return res.status(500).json({ error: message || "Failed to generate analysis" });
  }
});

export default router;
