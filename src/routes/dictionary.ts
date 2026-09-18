import { Router } from "express";
import { aggregateWordDetails } from "../services/dictionaryAggregator";

const router = Router();

const MAX_WORD_LENGTH = 60;

// Sanitize the incoming word: collapse whitespace, strip control characters,
// and keep it to a sane length. Allows letters, spaces, hyphens and apostrophes
// so multi-word or hyphenated headwords still work.
function sanitizeWord(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const stripped = collapsed.replace(/[^\p{L}\p{M}\-' ]/gu, "");
  return stripped.slice(0, MAX_WORD_LENGTH).trim();
}

// POST /api/dictionary/fetch
router.post("/fetch", async (req, res) => {
  try {
    const word = sanitizeWord(req.body?.word);

    if (!word) {
      return res.status(400).json({ error: "Missing or invalid word" });
    }

    const details = await aggregateWordDetails(word);

    const hasContent =
      details.sources.length > 0 ||
      details.definitions.length > 0 ||
      details.synonyms.length > 0 ||
      details.antonyms.length > 0 ||
      details.exampleSentences.length > 0 ||
      details.usageNotes.length > 0 ||
      details.ipaPronunciation.length > 0 ||
      details.originEtymology.length > 0;

    if (!hasContent) {
      return res.status(404).json({
        error: "NO_RESULTS",
        message: `No dictionary information found for "${word}".`,
      });
    }

    return res.json(details);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[vox:dictionary] fetch failed", message);
    return res.status(500).json({ error: "Failed to fetch dictionary details" });
  }
});

export default router;
