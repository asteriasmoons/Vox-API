import { Router } from "express";
import {
  CORRESPONDENCE_TYPES,
  getCachedCorrespondence,
  getOrGenerateCorrespondence,
  normalizeCorrespondenceType,
} from "../services/correspondenceEngineService";

const router = Router();

// Read a saved correspondence without falling through to AI generation.
router.get("/cached", async (req, res) => {
  const type = normalizeCorrespondenceType(requiredString(req.query.type));
  const name = requiredString(req.query.name);
  if (!type || !name) {
    return res.status(400).json({ error: "Valid type and name are required" });
  }

  try {
    const correspondence = await getCachedCorrespondence(type, name);
    return correspondence
      ? res.json(correspondence)
      : res.status(404).json({ error: "Correspondence not found" });
  } catch (error) {
    console.error("[correspondences] cached lookup error:", error);
    return res.status(500).json({ error: "Failed to load correspondence" });
  }
});

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function booleanFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

// POST /api/correspondences
router.post("/", async (req, res) => {
  try {
    const rawType = requiredString(req.body?.type);
    const name = requiredString(req.body?.name);
    const type = normalizeCorrespondenceType(rawType);
    const refresh = booleanFlag(req.body?.refresh);

    if (!rawType) {
      return res.status(400).json({ error: "type is required" });
    }

    if (!type) {
      return res.status(400).json({
        error: "Unsupported correspondence type",
        supportedTypes: CORRESPONDENCE_TYPES,
      });
    }

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    console.log("[correspondences] request", {
      type,
      name,
      refresh,
    });

    const correspondence = await getOrGenerateCorrespondence(type, name, {
      refresh,
    });

    console.log("[correspondences] response", {
      type: correspondence.type,
      name: correspondence.name,
      cached: correspondence.cached,
      ...(type === "essential_oil" && {
        essentialOilFields: {
          sourcePlant: Boolean(correspondence.sourcePlant),
          plantPartUsed: Boolean(correspondence.plantPartUsed),
          aromaProfile: Boolean(correspondence.aromaProfile),
          blendingNotes: Boolean(correspondence.blendingNotes),
          complementaryOils: correspondence.complementaryOils?.length ?? 0,
          commonSubstitutions: correspondence.commonSubstitutions?.length ?? 0,
        },
      }),
    });

    return res.json(correspondence);
  } catch (error) {
    console.error("[correspondences] error:", error);

    const message = error instanceof Error ? error.message : String(error);

    if (message === "Missing GROQ_API_KEY") {
      return res.status(500).json({ error: message });
    }

    if (message.startsWith("AI omitted essential oil")) {
      return res.status(502).json({
        error: "Essential oil details were incomplete. Please try again.",
      });
    }

    return res.status(500).json({
      error: "Failed to generate correspondence",
    });
  }
});

// GET /api/correspondences/types
router.get("/types", (_req, res) => {
  return res.json({ types: CORRESPONDENCE_TYPES });
});

export default router;
