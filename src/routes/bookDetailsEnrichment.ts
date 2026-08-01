import { Router } from "express";
import { enrichBookDetails } from "../services/bookDetailsEnrichmentService";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const author =
      typeof req.body?.author === "string" ? req.body.author.trim() : "";

    if (!title || !author) {
      return res.status(400).json({
        error: "Book title and author are required",
      });
    }

    const response = await enrichBookDetails({ title, author });
    return res.json(response);
  } catch (error) {
    console.error("Book details enrichment route error:", error);

    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("No confident") ? 404 : 500;

    return res.status(status).json({
      error: "Failed to enrich book details",
      detail: message,
    });
  }
});

export default router;
