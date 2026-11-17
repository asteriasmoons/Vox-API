import { Router, Request, Response } from "express";
import { runMoodChat, ChatMessage } from "../services/moodChatService";
import {
  generateMoodStatsContext,
  MoodStatsContextRequest,
  MoodStatsPhoneBehaviorInput,
  MoodStatsSummaryInput,
} from "../services/generateMoodStatsContext";
import { analyzeMood, MoodAnalysisInput } from "../services/analyzeMood";
import { MoodAnalysis } from "../models/MoodAnalysis";

const router = Router();

// POST /api/mood/chat
// Body: { messages: [{ role: "user" | "model", parts: [{ text: string }] }] }
router.post("/chat", async (req: Request, res: Response) => {
  try {
    const { messages } = req.body as { messages: ChatMessage[] };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    // Validate roles — Gemini only accepts "user" | "model"
    const valid = messages.every(
      (m) =>
        (m.role === "user" || m.role === "model") &&
        Array.isArray(m.parts) &&
        m.parts.every((p) => typeof p.text === "string"),
    );

    if (!valid) {
      res.status(400).json({
        error:
          'Each message must have role "user" or "model" and parts: [{ text: string }]',
      });
      return;
    }

    const reply = await runMoodChat(messages);
    res.json({ reply });
  } catch (err: any) {
    console.error("[mood/chat] Error:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

// POST /api/mood/stats/context
// Body: aggregate mood + phone stats only; no raw app names or detailed Screen Time history.
router.post("/stats/context", async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<MoodStatsContextRequest>;

    if (
      typeof body.date !== "string" ||
      !isValidMoodSummary(body.moodSummary) ||
      !isValidPhoneBehavior(body.phoneBehavior)
    ) {
      res.status(400).json({
        error: "date, moodSummary, and phoneBehavior are required",
      });
      return;
    }

    const requestBody: MoodStatsContextRequest = {
      userId:
        typeof body.userId === "string" && body.userId.trim()
          ? body.userId.trim()
          : "anonymous",
      date: body.date,
      moodSummary: body.moodSummary,
      phoneBehavior: body.phoneBehavior,
      recentSnapshots: Array.isArray(body.recentSnapshots)
        ? body.recentSnapshots
        : [],
    };

    const context = await generateMoodStatsContext(requestBody);
    res.json(context);
  } catch (err: any) {
    console.error("[mood/stats/context] Error:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

function isValidMoodSummary(value: unknown): value is MoodStatsSummaryInput {
  const summary = value as MoodStatsSummaryInput;
  return (
    typeof summary === "object" &&
    summary !== null &&
    Number.isFinite(summary.averageMoodPercent) &&
    Number.isFinite(summary.checkInCount) &&
    typeof summary.bestDay === "string" &&
    typeof summary.hardestDay === "string"
  );
}

function isValidPhoneBehavior(
  value: unknown,
): value is MoodStatsPhoneBehaviorInput {
  const behavior = value as MoodStatsPhoneBehaviorInput;
  return (
    typeof behavior === "object" &&
    behavior !== null &&
    Number.isFinite(behavior.screenTimeMinutes) &&
    Number.isFinite(behavior.socialAppMinutes) &&
    Number.isFinite(behavior.nighttimePhoneMinutes) &&
    Number.isFinite(behavior.pickupCount) &&
    Number.isFinite(behavior.notificationCount)
  );
}

// POST /api/mood/analyze
// Analyze a mood log via AI and save the result
router.post("/analyze", async (req: Request, res: Response) => {
  try {
    const {
      userId,
      moodEntryId,
      emotions,
      activities,
      sleepHours,
      exerciseMinutes,
      steps,
      meditationMinutes,
      waterOz,
      note,
      timestamp,
    } = req.body;

    if (!userId || !moodEntryId) {
      res.status(400).json({ error: "userId and moodEntryId are required" });
      return;
    }

    if (!Array.isArray(emotions) || emotions.length === 0) {
      res.status(400).json({ error: "emotions array is required" });
      return;
    }

    // Cap: one analysis per mood log per calendar day
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const existing = await MoodAnalysis.findOne({
      userId,
      moodEntryId,
      createdAt: { $gte: todayStart },
    }).lean();

    if (existing) {
      res.json({
        id: existing._id,
        mindset: existing.mindset,
        emotionalBalance: existing.emotionalBalance,
        influences: existing.influences,
        reflection: existing.reflection,
        themes: existing.themes,
        createdAt: existing.createdAt,
        cached: true,
      });
      return;
    }

    const input: MoodAnalysisInput = {
      emotions,
      activities: activities || [],
      sleepHours: sleepHours || 0,
      exerciseMinutes: exerciseMinutes || 0,
      steps: steps || 0,
      meditationMinutes: meditationMinutes || 0,
      waterOz: waterOz || 0,
      note: note || "",
      timestamp: timestamp || new Date().toISOString(),
    };

    const result = await analyzeMood(input);

    // Save to MongoDB
    const doc = await MoodAnalysis.create({
      userId,
      moodEntryId,
      timestamp: input.timestamp,
      mindset: result.mindset,
      emotionalBalance: result.emotionalBalance,
      influences: result.influences,
      reflection: result.reflection,
      themes: result.themes,
      emotions: emotions.map((e: any) => e.name),
      activities: activities || [],
    });

    res.json({
      id: doc._id,
      mindset: result.mindset,
      emotionalBalance: result.emotionalBalance,
      influences: result.influences,
      reflection: result.reflection,
      themes: result.themes,
      createdAt: doc.createdAt,
    });
  } catch (err: any) {
    console.error("[mood/analyze] Error:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Failed to analyze mood" });
  }
});

// GET /api/mood/analyze/history?userId=X&moodEntryId=Y
// Fetch all past analyses for a specific mood log
router.get("/analyze/history", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query?.userId || "").trim();
    const moodEntryId = String(req.query?.moodEntryId || "").trim();

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const query: any = { userId };
    if (moodEntryId) query.moodEntryId = moodEntryId;

    const analyses = await MoodAnalysis.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({
      analyses: analyses.map((a) => ({
        id: a._id,
        moodEntryId: a.moodEntryId,
        timestamp: a.timestamp,
        mindset: a.mindset,
        emotionalBalance: a.emotionalBalance,
        influences: a.influences,
        reflection: a.reflection,
        themes: a.themes,
        emotions: a.emotions,
        activities: a.activities,
        createdAt: a.createdAt,
      })),
    });
  } catch (err: any) {
    console.error("[mood/analyze/history] Error:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Failed to fetch history" });
  }
});

export default router;
