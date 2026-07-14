import { Router, type Request, type Response } from "express";
import {
  SeeryService,
  SeeryTMDBService,
  SeeryIDMapper,
  SeeryServiceError,
} from "../services/seery.service";

const router = Router();
const seeryService = new SeeryService();
const tmdbService = new SeeryTMDBService();
const idMapper = new SeeryIDMapper(seeryService, tmdbService);

// ═══════════════════════════════════════════════════════════════════
// Health
// ═══════════════════════════════════════════════════════════════════

router.get("/health", async (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      service: "seery",
      configured: seeryService.isConfigured && tmdbService.isConfigured,
      providers: {
        tvmaze: { configured: seeryService.isConfigured },
        tmdb: { configured: tmdbService.isConfigured },
      },
    },
  });
});

// ═══════════════════════════════════════════════════════════════════
// TVmaze Routes (primary)
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/seery/search?query=severance
 */
router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = readRequiredString(req.query.query, "query");
    const data = await seeryService.searchSeries(query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/seery/schedule?date=2026-07-13&country=US
 */
router.get("/schedule", async (req: Request, res: Response) => {
  try {
    const date = readOptionalString(req.query.date);
    const country = readOptionalString(req.query.country) ?? "US";
    const data = await seeryService.getSchedule(date, country);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/seery/schedule/web?date=2026-07-13
 */
router.get("/schedule/web", async (req: Request, res: Response) => {
  try {
    const date = readOptionalString(req.query.date);
    const data = await seeryService.getWebSchedule(date);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/seery/series/:showId
 */
router.get("/series/:showId", async (req: Request, res: Response) => {
  try {
    const showId = readId(req.params.showId, "showId");
    const data = await seeryService.getSeriesDetails(showId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/seery/series/:showId/season/:seasonNumber
 */
router.get(
  "/series/:showId/season/:seasonNumber",
  async (req: Request, res: Response) => {
    try {
      const showId = readId(req.params.showId, "showId");
      const seasonNumber = readNonNegativeInteger(
        req.params.seasonNumber,
        "seasonNumber"
      );
      const data = await seeryService.getSeasonEpisodes(showId, seasonNumber);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/series/:showId/cast
 */
router.get(
  "/series/:showId/cast",
  async (req: Request, res: Response) => {
    try {
      const showId = readId(req.params.showId, "showId");
      const data = await seeryService.getShowCast(showId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/series/:showId/images
 */
router.get(
  "/series/:showId/images",
  async (req: Request, res: Response) => {
    try {
      const showId = readId(req.params.showId, "showId");
      const data = await seeryService.getShowImages(showId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// TMDB Routes (secondary — trending, discover, genres, recs, etc.)
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/seery/trending?window=day&page=1
 */
router.get("/trending", async (req: Request, res: Response) => {
  try {
    const timeWindow =
      readOptionalString(req.query.window) === "week" ? "week" : "day";
    const page = readOptionalPositiveInt(req.query.page) ?? 1;
    const data = await tmdbService.trending(timeWindow, page);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/seery/airing-today?page=1
 */
router.get("/airing-today", async (req: Request, res: Response) => {
  try {
    const page = readOptionalPositiveInt(req.query.page) ?? 1;
    const data = await tmdbService.airingToday(page);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/seery/discover?page=1&sort_by=popularity.desc&with_genres=18&...
 */
router.get("/discover", async (req: Request, res: Response) => {
  try {
    const filters: Parameters<typeof tmdbService.discover>[0] = {};
    const page = readOptionalPositiveInt(req.query.page);
    if (page !== undefined) filters.page = page;
    const sortBy = readOptionalString(req.query.sort_by);
    if (sortBy !== undefined) filters.sortBy = sortBy;
    const withGenres = readOptionalString(req.query.with_genres);
    if (withGenres !== undefined) filters.withGenres = withGenres;
    const firstAirDateGte = readOptionalString(req.query["first_air_date.gte"]);
    if (firstAirDateGte !== undefined) filters.firstAirDateGte = firstAirDateGte;
    const firstAirDateLte = readOptionalString(req.query["first_air_date.lte"]);
    if (firstAirDateLte !== undefined) filters.firstAirDateLte = firstAirDateLte;
    const voteAverageGte = readOptionalFloat(req.query["vote_average.gte"]);
    if (voteAverageGte !== undefined) filters.voteAverageGte = voteAverageGte;
    const withStatus = readOptionalString(req.query.with_status);
    if (withStatus !== undefined) filters.withStatus = withStatus;

    const data = await tmdbService.discover(filters);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/seery/genres
 */
router.get("/genres", async (req: Request, res: Response) => {
  try {
    const language = readOptionalString(req.query.language) ?? "en";
    const data = await tmdbService.genres(language);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/seery/series/:seriesId/recommendations?page=1
 *
 * Accepts a TMDB series ID. If a TVmaze ID is passed, use the
 * /api/seery/tvmaze/:showId/recommendations endpoint instead.
 */
router.get(
  "/series/:seriesId/recommendations",
  async (req: Request, res: Response) => {
    try {
      const tmdbId = readId(req.params.seriesId, "seriesId");
      const page = readOptionalPositiveInt(req.query.page) ?? 1;
      const data = await tmdbService.recommendations(tmdbId, page);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/tvmaze/:showId/recommendations?page=1
 *
 * Convenience: maps a TVmaze ID → TMDB ID, then fetches TMDB recommendations.
 */
router.get(
  "/tvmaze/:showId/recommendations",
  async (req: Request, res: Response) => {
    try {
      const tvMazeId = readId(req.params.showId, "showId");
      const page = readOptionalPositiveInt(req.query.page) ?? 1;

      const tmdbId = await idMapper.tmdbIdFromTVmaze(tvMazeId);
      if (!tmdbId) {
        throw new SeeryServiceError(
          404,
          "SEERY_TMDB_ID_NOT_FOUND",
          `Could not find a TMDB match for TVmaze show ${tvMazeId}.`
        );
      }

      const data = await tmdbService.recommendations(tmdbId, page);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/series/:seriesId/providers?region=US
 *
 * Accepts a TMDB series ID.
 */
router.get(
  "/series/:seriesId/providers",
  async (req: Request, res: Response) => {
    try {
      const tmdbId = readId(req.params.seriesId, "seriesId");
      const region = readOptionalString(req.query.region) ?? "US";
      const data = await tmdbService.watchProviders(tmdbId, region);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/tvmaze/:showId/providers?region=US
 *
 * Convenience: maps TVmaze ID → TMDB ID, then fetches watch providers.
 */
router.get(
  "/tvmaze/:showId/providers",
  async (req: Request, res: Response) => {
    try {
      const tvMazeId = readId(req.params.showId, "showId");
      const region = readOptionalString(req.query.region) ?? "US";

      const tmdbId = await idMapper.tmdbIdFromTVmaze(tvMazeId);
      if (!tmdbId) {
        throw new SeeryServiceError(
          404,
          "SEERY_TMDB_ID_NOT_FOUND",
          `Could not find a TMDB match for TVmaze show ${tvMazeId}.`
        );
      }

      const data = await tmdbService.watchProviders(tmdbId, region);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/series/:seriesId/videos
 */
router.get(
  "/series/:seriesId/videos",
  async (req: Request, res: Response) => {
    try {
      const tmdbId = readId(req.params.seriesId, "seriesId");
      const data = await tmdbService.videos(tmdbId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/tvmaze/:showId/videos
 */
router.get(
  "/tvmaze/:showId/videos",
  async (req: Request, res: Response) => {
    try {
      const tvMazeId = readId(req.params.showId, "showId");

      const tmdbId = await idMapper.tmdbIdFromTVmaze(tvMazeId);
      if (!tmdbId) {
        throw new SeeryServiceError(
          404,
          "SEERY_TMDB_ID_NOT_FOUND",
          `Could not find a TMDB match for TVmaze show ${tvMazeId}.`
        );
      }

      const data = await tmdbService.videos(tmdbId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/series/:seriesId/reviews?page=1
 *
 * Accepts a TMDB series ID.
 */
router.get(
  "/series/:seriesId/reviews",
  async (req: Request, res: Response) => {
    try {
      const tmdbId = readId(req.params.seriesId, "seriesId");
      const page = readOptionalPositiveInt(req.query.page) ?? 1;
      const data = await tmdbService.reviews(tmdbId, page);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/tvmaze/:showId/reviews?page=1
 *
 * Convenience: maps TVmaze ID → TMDB ID, then fetches reviews.
 */
router.get(
  "/tvmaze/:showId/reviews",
  async (req: Request, res: Response) => {
    try {
      const tvMazeId = readId(req.params.showId, "showId");
      const page = readOptionalPositiveInt(req.query.page) ?? 1;

      const tmdbId = await idMapper.tmdbIdFromTVmaze(tvMazeId);
      if (!tmdbId) {
        throw new SeeryServiceError(
          404,
          "SEERY_TMDB_ID_NOT_FOUND",
          `Could not find a TMDB match for TVmaze show ${tvMazeId}.`
        );
      }

      const data = await tmdbService.reviews(tmdbId, page);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// ID Mapping Routes
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/seery/map/tvmaze/:showId
 * Returns the full ID mapping for a TVmaze show.
 */
router.get(
  "/map/tvmaze/:showId",
  async (req: Request, res: Response) => {
    try {
      const tvMazeId = readId(req.params.showId, "showId");
      const data = await idMapper.resolveFromTVmaze(tvMazeId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

/**
 * GET /api/seery/map/tmdb/:seriesId
 * Returns the full ID mapping for a TMDB series.
 */
router.get(
  "/map/tmdb/:seriesId",
  async (req: Request, res: Response) => {
    try {
      const tmdbId = readId(req.params.seriesId, "seriesId");
      const data = await idMapper.resolveFromTMDB(tmdbId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }
);

// ─── Helpers ─────────────────────────────────────────────────────

function sendError(res: Response, error: unknown): void {
  if (error instanceof SeeryServiceError) {
    const payload: {
      success: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
    } = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    };

    if (error.details !== undefined) {
      payload.error.details = error.details;
    }

    res.status(error.statusCode).json(payload);
    return;
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";

  res.status(500).json({
    success: false,
    error: {
      code: "SEERY_INTERNAL_ERROR",
      message,
    },
  });
}

function readRequiredString(value: unknown, field: string): string {
  const parsed = readOptionalString(value);
  if (!parsed) {
    throw new SeeryServiceError(
      400,
      "SEERY_INVALID_REQUEST",
      `${field} is required.`
    );
  }
  return parsed;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readId(value: unknown, field: string): number {
  const normalized = readRouteParameter(value, field);
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SeeryServiceError(
      400,
      "SEERY_INVALID_REQUEST",
      `${field} must be a positive integer.`
    );
  }
  return parsed;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  const normalized = readRouteParameter(value, field);
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new SeeryServiceError(
      400,
      "SEERY_INVALID_REQUEST",
      `${field} must be a non-negative integer.`
    );
  }
  return parsed;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  const str = readOptionalString(value);
  if (!str) return undefined;
  const parsed = Number(str);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readOptionalFloat(value: unknown): number | undefined {
  const str = readOptionalString(value);
  if (!str) return undefined;
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readRouteParameter(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (
    Array.isArray(value) &&
    value.length === 1 &&
    typeof value[0] === "string" &&
    value[0].trim().length > 0
  ) {
    return value[0].trim();
  }

  throw new SeeryServiceError(
    400,
    "SEERY_INVALID_REQUEST",
    `${field} is required and must be a single value.`
  );
}

export default router;
