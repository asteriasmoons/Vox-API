import { Router } from "express";
import { buildRecommendationCollections } from "../services/recommendationCollectionService";

const router = Router();

/**
 * POST /api/books/recommendation-collections
 * body: { userId?: string, collectionId?: string, readerContext?: {...}, excludeBookKeys?: string[] }
 *
 * Returns: { collections: [...] }
 */
router.post("/", async (req, res) => {
  try {
    const excludeBookKeys = Array.isArray(req.body?.excludeBookKeys)
      ? req.body.excludeBookKeys.filter(
          (key: unknown): key is string => typeof key === "string",
        )
      : undefined;
    const desiredCollections =
      typeof req.body?.desiredCollections === "number"
        ? req.body.desiredCollections
        : undefined;
    const booksPerCollection =
      typeof req.body?.booksPerCollection === "number"
        ? req.body.booksPerCollection
        : undefined;
    const userId =
      typeof req.body?.userId === "string" ? req.body.userId : undefined;
    const collectionId =
      typeof req.body?.collectionId === "string"
        ? req.body.collectionId
        : undefined;

    const response = await buildRecommendationCollections({
      ...(userId ? { userId } : {}),
      ...(collectionId ? { collectionId } : {}),
      ...(req.body?.readerContext ? { readerContext: req.body.readerContext } : {}),
      ...(excludeBookKeys ? { excludeBookKeys } : {}),
      ...(desiredCollections !== undefined ? { desiredCollections } : {}),
      ...(booksPerCollection !== undefined ? { booksPerCollection } : {}),
    });

    return res.json(response);
  } catch (err) {
    console.error("Recommendation collections route error:", err);

    const message = err instanceof Error ? err.message : String(err);

    return res.status(500).json({
      error: "Failed to fetch recommendation collections",
      detail: message,
    });
  }
});

export default router;
