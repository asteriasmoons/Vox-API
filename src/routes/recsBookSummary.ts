//
//  recsBookSummary.ts
//  POST /api/books/recs/book-summary
//  On-demand compelling summary for a single regular-recs book (Cerebras).
//

import { Router } from "express";
import {
  buildRegularRecBookSummary,
  type RegularRecSummaryInput,
} from "../services/regularRecs/regularRecsBookSummary";

const router = Router();

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length ? out : undefined;
}

router.post("/", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const author = String(req.body?.author || "").trim();
    if (!title || !author) {
      return res.status(400).json({ error: "Book title and author are required" });
    }

    const input: RegularRecSummaryInput = {
      title,
      author,
      ...(typeof req.body?.summary === "string" ? { summary: req.body.summary } : {}),
      ...(typeof req.body?.rationale === "string" ? { rationale: req.body.rationale } : {}),
      ...(typeof req.body?.strategyLabel === "string" ? { strategyLabel: req.body.strategyLabel } : {}),
      ...(stringArray(req.body?.genres) ? { genres: stringArray(req.body?.genres) } : {}),
      ...(stringArray(req.body?.moods) ? { moods: stringArray(req.body?.moods) } : {}),
      ...(stringArray(req.body?.tropes) ? { tropes: stringArray(req.body?.tropes) } : {}),
      ...(stringArray(req.body?.themes) ? { themes: stringArray(req.body?.themes) } : {}),
      ...(stringArray(req.body?.tags) ? { tags: stringArray(req.body?.tags) } : {}),
      ...(typeof req.body?.pages === "number" ? { pages: req.body.pages } : {}),
      ...(typeof req.body?.releaseYear === "number" ? { releaseYear: req.body.releaseYear } : {}),
      ...(typeof req.body?.rating === "number" ? { rating: req.body.rating } : {}),
      ...(typeof req.body?.source === "string" ? { source: req.body.source } : {}),
    };

    const result = await buildRegularRecBookSummary(input);
    return res.json(result);
  } catch (err) {
    console.error("Regular recs book-summary route error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      error: "Failed to generate book summary",
      detail: message,
    });
  }
});

export default router;
