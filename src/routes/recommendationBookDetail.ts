import { Router } from "express";
import { buildRecommendationBookDetail } from "../services/recommendationBookDetailService";

const router = Router();

/**
 * POST /api/books/recommendation-book-detail
 * body: { title, author, summary?, coverUrl?, pages?, releaseYear?, rating?, tags?, genres?, moods?, tropes?, themes? }
 */
router.post("/", async (req, res) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const author = typeof req.body?.author === "string" ? req.body.author.trim() : "";

    if (!title || !author) {
      return res.status(400).json({ error: "Book title and author are required" });
    }

    const stringArray = (value: unknown): string[] | undefined =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : undefined;
    const numberValue = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const stringValue = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;

    const summary = stringValue(req.body?.summary);
    const coverUrl = stringValue(req.body?.coverUrl);
    const pages = numberValue(req.body?.pages);
    const releaseYear = numberValue(req.body?.releaseYear);
    const rating = numberValue(req.body?.rating);
    const tags = stringArray(req.body?.tags);
    const genres = stringArray(req.body?.genres);
    const moods = stringArray(req.body?.moods);
    const tropes = stringArray(req.body?.tropes);
    const themes = stringArray(req.body?.themes);
    const source = stringValue(req.body?.source);
    const strategyLabel = stringValue(req.body?.strategyLabel);
    const rationale = stringValue(req.body?.rationale);

    const response = await buildRecommendationBookDetail({
      title,
      author,
      ...(summary ? { summary } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      ...(pages !== undefined ? { pages } : {}),
      ...(releaseYear !== undefined ? { releaseYear } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(tags ? { tags } : {}),
      ...(genres ? { genres } : {}),
      ...(moods ? { moods } : {}),
      ...(tropes ? { tropes } : {}),
      ...(themes ? { themes } : {}),
      ...(source ? { source } : {}),
      ...(strategyLabel ? { strategyLabel } : {}),
      ...(rationale ? { rationale } : {}),
    });

    return res.json(response);
  } catch (err) {
    console.error("Recommendation book detail route error:", err);

    const message = err instanceof Error ? err.message : String(err);

    return res.status(500).json({
      error: "Failed to fetch recommendation book detail",
      detail: message,
    });
  }
});

export default router;
