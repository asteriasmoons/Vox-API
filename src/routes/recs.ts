//
//  recs.ts
//  POST /api/books/recs  — REGULAR (books-like-this / reading-request) recommendations.
//
//  Thin route. All logic lives in ../services/regularRecs/* which shares NO code
//  with the recommendation-collections / shelves system.
//

import { Router } from "express";
import {
  REGULAR_GROQ_MODEL,
  REGULAR_MAX_REQUEST_TEXT_LENGTH,
  REGULAR_MIN_ACCEPTABLE_RECOMMENDATION_COUNT,
  REGULAR_TARGET_FINAL_RECOMMENDATION_COUNT,
  REGULAR_TTL_FINAL,
} from "../services/regularRecs/regularRecsConfig";
import { regularRecsCache } from "../services/regularRecs/regularRecsCache";
import {
  buildRegularRecommendations,
  regularCandidateGroupCounts,
  regularExcludeHash,
} from "../services/regularRecs/regularRecsEngine";
import { normalizeTitle } from "../services/regularRecs/regularRecsUtils";

const router = Router();

/**
 * POST /api/books/recs
 * body: { query?: string, genre?: string, desiredCount?, minVerifiedResults?, excludeBookKeys? }
 * -> { recs, meta, requestProfile, resolvedSeed, generatedCount, verifiedCount }
 */
router.post("/", async (req, res) => {
  try {
    const requestText = String(req.body?.query || req.body?.genre || "")
      .trim()
      .slice(0, REGULAR_MAX_REQUEST_TEXT_LENGTH);
    if (!requestText) {
      return res.status(400).json({ error: "Recommendation query is required" });
    }

    const desiredCount =
      typeof req.body?.desiredCount === "number"
        ? req.body.desiredCount
        : REGULAR_TARGET_FINAL_RECOMMENDATION_COUNT;
    const minVerified =
      typeof req.body?.minVerifiedResults === "number"
        ? req.body.minVerifiedResults
        : REGULAR_MIN_ACCEPTABLE_RECOMMENDATION_COUNT;
    const excludeBookKeys = Array.isArray(req.body?.excludeBookKeys)
      ? req.body.excludeBookKeys.filter(
          (k: unknown): k is string => typeof k === "string",
        )
      : [];

    const cacheKey = `final:${normalizeTitle(requestText)}:${desiredCount}:${regularExcludeHash(excludeBookKeys)}`;
    const cached = regularRecsCache.get<Record<string, unknown>>(cacheKey);
    if (cached) return res.json(cached);

    console.log("Regular recommendation request:", {
      requestText,
      model: REGULAR_GROQ_MODEL,
    });

    const result = await buildRegularRecommendations(
      requestText,
      desiredCount,
      minVerified,
      excludeBookKeys,
    );

    const response = {
      recs: result.recs,
      meta: {
        requestType: result.profile.requestType,
        normalizedQuery: requestText,
        seedResolved: result.seed !== null,
        candidateGroups: regularCandidateGroupCounts(result.recs),
        verifiedCandidateCount: result.verifiedCount,
      },
      requestProfile: result.profile,
      resolvedSeed: result.seed,
      generatedCount: result.generatedCount,
      verifiedCount: result.verifiedCount,
    };

    console.log("Regular recommendations returned:", {
      requestType: result.profile.requestType,
      seedResolved: result.seed !== null,
      generated: result.generatedCount,
      verified: result.verifiedCount,
      returned: result.recs.length,
    });

    if (result.recs.length > 0) {
      regularRecsCache.set(cacheKey, response, REGULAR_TTL_FINAL);
    }

    return res.json(response);
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
