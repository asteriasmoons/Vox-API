import { Router } from "express";
import {
  CORRESPONDENCE_TYPES,
  getOrGenerateCorrespondence,
  normalizeCorrespondenceType,
} from "../services/correspondenceEngineService";

const router = Router();

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
    });

    return res.json(correspondence);
  } catch (error) {
    console.error("[correspondences] error:", error);

    const message = error instanceof Error ? error.message : String(error);

    if (message === "Missing GROQ_API_KEY") {
      return res.status(500).json({ error: message });
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
