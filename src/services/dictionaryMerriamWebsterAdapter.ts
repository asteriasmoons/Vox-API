// Adapter for Merriam-Webster's Collegiate Dictionary API.
// Uses the server-side MERRIAM_WEBSTER_KEY only; the key is never sent to Markly.

import {
  AdapterResult,
  cleanWhitespace,
  fetchWithTimeout,
  stripDictionaryMarkup,
} from "./dictionaryShared";

const SOURCE_NAME = "Merriam-Webster's Collegiate Dictionary";
const BASE_URL = "https://www.dictionaryapi.com/api/v3/references/collegiate/json/";
const TIMEOUT_MS = 20_000;

type MWPronunciation = { mw?: unknown };
type MWHwi = { prs?: unknown };
type MWEntry = {
  meta?: unknown;
  hwi?: unknown;
  fl?: unknown;
  shortdef?: unknown;
  et?: unknown;
  suppl?: unknown;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(cleanWhitespace).filter(Boolean) : [];
}

function etymology(entry: MWEntry): string {
  if (!Array.isArray(entry.et)) return "";
  const pieces: string[] = [];
  for (const item of entry.et) {
    if (!Array.isArray(item)) continue;
    for (const part of item) {
      if (typeof part === "string" && part !== "text") pieces.push(stripDictionaryMarkup(part));
    }
  }
  return pieces.filter(Boolean).join(" ");
}
function supplementalExamples(entry: MWEntry): string[] {
  if (!entry.suppl || typeof entry.suppl !== "object") return [];
  const examples = (entry.suppl as Record<string, unknown>).examples;
  if (!Array.isArray(examples)) return [];
  return examples.map((item) => {
    if (!item || typeof item !== "object") return "";
    return stripDictionaryMarkup((item as Record<string, unknown>).t);
  }).filter(Boolean);
}

export async function fetchMerriamWebster(word: string): Promise<AdapterResult | null> {
  const key = process.env.MERRIAM_WEBSTER_KEY || "";
  if (!key) {
    console.error("[vox:dictionary] Merriam-Webster unavailable", {
      word, message: "Missing MERRIAM_WEBSTER_KEY environment variable",
    });
    return null;
  }

  const cleaned = word.trim().toLowerCase();
  if (!cleaned) return null;
  const url = BASE_URL + encodeURIComponent(cleaned) + "?key=" + encodeURIComponent(key);

  let rows: unknown[];
  try {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(url, { timeoutMs: TIMEOUT_MS });
    if (!response.ok) {
      console.error("[vox:dictionary] Merriam-Webster HTTP failure", {
        word, status: response.status, statusText: response.statusText,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }
    const json = await response.json().catch(() => null);
    if (!Array.isArray(json)) return null;
    rows = json;
    console.log("[vox:dictionary] Merriam-Webster success", {
      word, durationMs: Date.now() - startedAt, results: rows.length,
    });
  } catch (error) {
    console.error("[vox:dictionary] Merriam-Webster lookup failed", {
      word, message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  // A string-only response is Merriam-Webster's spelling-suggestion response.
  const entries = rows.filter((row) => row && typeof row === "object") as MWEntry[];
  if (!entries.length) return null;

  const partsOfSpeech: string[] = [];
  const writtenPronunciation: string[] = [];
  const definitions: string[] = [];
  const examples: string[] = [];
  let origin = "";

  for (const entry of entries) {
    const pos = cleanWhitespace(entry.fl);
    if (pos) partsOfSpeech.push(pos);
    definitions.push(...strings(entry.shortdef).map(stripDictionaryMarkup));
    examples.push(...supplementalExamples(entry));
    if (!origin) origin = etymology(entry);

    const hwi = entry.hwi as MWHwi | undefined;
    if (Array.isArray(hwi?.prs)) {
      for (const pronunciation of hwi.prs as MWPronunciation[]) {
        const value = cleanWhitespace(pronunciation?.mw);
        if (value) writtenPronunciation.push(value);
      }
    }
  }

  const contributed = partsOfSpeech.length || writtenPronunciation.length ||
    definitions.length || examples.length || origin.length;
  if (!contributed) return null;

  return {
    source: { name: SOURCE_NAME, url: "https://www.merriam-webster.com/dictionary/" + encodeURIComponent(cleaned) },
    partsOfSpeech,
    ipa: [],
    writtenPronunciation,
    definitions,
    examples,
    synonyms: [],
    antonyms: [],
    relatedWords: [],
    origin,
  };
}
