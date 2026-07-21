import { Router } from "express";
import { buildRecommendations } from "../services/recommendationEngine";

const router = Router();

/**
 * POST /api/books/recs
 * body: { genre: string }
 *
 * Returns: { recs: [...] }
 */
router.post("/", async (req, res) => {
  try {
    const genreRaw = String(req.body?.genre || "").trim();
    if (!genreRaw) {
      return res.status(400).json({ error: "Genre is required" });
    }

    const response = await buildRecommendations({
      query: genreRaw,
      surface: "route",
      desiredCount: 30,
      minVerifiedResults: 12,
    });

    return res.json({ recs: response.recs });
  } catch (err) {
    console.error("Recommendations route error:", err);

    const message = err instanceof Error ? err.message : String(err);

    return res.status(500).json({
      error: "Failed to fetch recommendations",
      detail: message,
    });
  }
});

export default router;
