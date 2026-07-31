import { Router } from "express";
import {
  generateReadingMissions,
  type ReadingMissionBookInput,
} from "../services/readingMissionService";

const router = Router();

router.post("/generate", async (req, res) => {
  try {
    const rawBook = isRecord(req.body?.book) ? req.body.book : {};
    const title = cleanText(rawBook.title);
    const author = cleanText(rawBook.author);

    if (!title || !author) {
      return res.status(400).json({ error: "Book title and author are required" });
    }

    const pageCount = numberValue(rawBook.pageCount);
    const book: ReadingMissionBookInput = {
      title,
      author,
      ...(cleanText(rawBook.synopsis) ? { synopsis: cleanText(rawBook.synopsis) } : {}),
      ...(cleanArray(rawBook.genres).length ? { genres: cleanArray(rawBook.genres) } : {}),
      ...(cleanArray(rawBook.tags).length ? { tags: cleanArray(rawBook.tags) } : {}),
      ...(pageCount !== undefined ? { pageCount } : {}),
      ...(cleanText(rawBook.seriesName) ? { seriesName: cleanText(rawBook.seriesName) } : {}),
      ...(cleanText(rawBook.seriesNumber) ? { seriesNumber: cleanText(rawBook.seriesNumber) } : {}),
    };

    const missions = await generateReadingMissions(book);
    return res.json(missions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reading-missions] route error:", message);
    return res.status(500).json({
      error: "Failed to generate reading missions",
      detail: message,
    });
  }
});

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanText).filter((item) => item.length > 0).slice(0, 18)
    : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default router;
