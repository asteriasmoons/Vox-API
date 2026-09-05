import { Router } from "express";
import {
  getOrGenerateSpell,
  getSavedSpellsForCategory,
  normalizePractitionerLevel,
  normalizeSpellCategory,
  SPELL_CATEGORIES,
} from "../services/spellEngineService";

const router = Router();

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sentenceCount(value: string): number {
  const matches = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  return matches.map((item) => item.trim()).filter(Boolean).length;
}

// POST /api/spells/generate
router.post("/generate", async (req, res) => {
  try {
    const rawCategory = requiredString(req.body?.category);
    const category = normalizeSpellCategory(rawCategory);
    const intention = requiredString(req.body?.intention);
    const level = normalizePractitionerLevel(requiredString(req.body?.level));
    const context = requiredString(req.body?.context);
    const refresh = true;

    if (!rawCategory) {
      return res.status(400).json({ error: "category is required" });
    }

    if (!category) {
      return res.status(400).json({
        error: "Unsupported spell category",
        categories: SPELL_CATEGORIES,
      });
    }

    if (!intention) {
      return res.status(400).json({ error: "intention is required" });
    }

    if (!level) {
      return res.status(400).json({
        error: "level must be beginner, intermediate, or advanced",
      });
    }

    if (!context) {
      return res.status(400).json({ error: "context is required" });
    }

    if (sentenceCount(context) > 2) {
      return res.status(400).json({
        error: "context must be no more than two sentences",
      });
    }

    console.log("[spells] generate request", {
      category,
      intention,
      level,
      refresh,
    });

    const spell = await getOrGenerateSpell({
      category,
      intention,
      level,
      context,
      refresh,
    });

    console.log("[spells] generate response", {
      category: spell.category,
      intention: spell.intention,
      title: spell.title,
      cached: spell.cached,
    });

    return res.json(spell);
  } catch (error) {
    console.error("[spells] generate error:", error);

    const message = error instanceof Error ? error.message : String(error);

    if (message === "Missing GROQ_API_KEY") {
      return res.status(500).json({ error: message });
    }

    if (
      message === "Unsupported spell category" ||
      message === "Unsupported intention for category"
    ) {
      return res.status(400).json({ error: message });
    }

    return res.status(500).json({ error: "Failed to generate spell" });
  }
});

// GET /api/spells/categories
router.get("/categories", (_req, res) => {
  return res.json({ categories: SPELL_CATEGORIES });
});

// GET /api/spells/:category
router.get("/:category", async (req, res) => {
  try {
    const category = normalizeSpellCategory(requiredString(req.params.category));

    if (!category) {
      return res.status(400).json({
        error: "Unsupported spell category",
        categories: SPELL_CATEGORIES,
      });
    }

    const spells = await getSavedSpellsForCategory(category);
    return res.json({ spells });
  } catch (error) {
    console.error("[spells] list error:", error);
    return res.status(500).json({ error: "Failed to fetch spells" });
  }
});

export default router;
