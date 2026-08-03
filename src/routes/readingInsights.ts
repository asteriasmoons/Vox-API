import { Router } from "express";
import {
  generateReadingInsightReview,
  type ReadingInsightReviewBookInput,
  type ReadingInsightReviewInsightInput,
} from "../services/readingInsightReviewService";

const router = Router();

router.post("/generate-review", async (req, res) => {
  try {
    const rawBook = isRecord(req.body?.book) ? req.body.book : {};
    const rawInsights = Array.isArray(req.body?.insights) ? req.body.insights : [];

    const book = normalizeBook(rawBook);
    const insights = rawInsights
      .filter(isRecord)
      .map(normalizeInsight);

    const review = await generateReadingInsightReview({ book, insights });
    return res.json(review);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("required") ? 400 : 500;

    console.error("[reading-insights] route error:", message);
    return res.status(status).json({
      error: "Failed to generate reading insight review",
      detail: message,
    });
  }
});

function normalizeBook(rawBook: Record<string, unknown>): ReadingInsightReviewBookInput {
  const book: ReadingInsightReviewBookInput = {
    title: cleanText(rawBook.title),
    author: cleanText(rawBook.author),
    genres: cleanArray(rawBook.genres),
    moods: cleanArray(rawBook.moods),
    topics: cleanArray(rawBook.topics),
    tags: cleanArray(rawBook.tags),
    tropes: cleanArray(rawBook.tropes),
  };

  const subtitle = cleanText(rawBook.subtitle);
  if (subtitle) book.subtitle = subtitle;

  if (typeof rawBook.rating === "number" && Number.isFinite(rawBook.rating)) {
    book.rating = rawBook.rating;
  }

  return book;
}

function normalizeInsight(rawInsight: Record<string, unknown>): ReadingInsightReviewInsightInput {
  const insight: ReadingInsightReviewInsightInput = {
    dateCreated: cleanText(rawInsight.dateCreated),
    whatHappened: cleanText(rawInsight.whatHappened),
    whatStoodOut: cleanText(rawInsight.whatStoodOut),
    howIFeel: cleanText(rawInsight.howIFeel),
    predictions: cleanText(rawInsight.predictions),
    favoriteMoment: cleanText(rawInsight.favoriteMoment),
    favoriteQuote: cleanText(rawInsight.favoriteQuote),
    aiSummary: cleanText(rawInsight.aiSummary),
  };

  const sessionDate = cleanText(rawInsight.sessionDate);
  if (sessionDate) insight.sessionDate = sessionDate;

  if (typeof rawInsight.sessionMinutes === "number" && Number.isFinite(rawInsight.sessionMinutes)) {
    insight.sessionMinutes = rawInsight.sessionMinutes;
  }

  if (typeof rawInsight.sessionPages === "number" && Number.isFinite(rawInsight.sessionPages)) {
    insight.sessionPages = rawInsight.sessionPages;
  }

  return insight;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanText).filter((item) => item.length > 0).slice(0, 18)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default router;
