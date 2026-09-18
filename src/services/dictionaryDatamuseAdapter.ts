// Adapter for Datamuse (https://www.datamuse.com/api/).
// No key is required before 2027. Supplies definitions/POS/pronunciation
// metadata plus WordNet-backed synonym, antonym, and related-word relations.

import {
  AdapterResult,
  cleanWhitespace,
  fetchWithTimeout,
  looksLikeTerm,
} from "./dictionaryShared";

const SOURCE_NAME = "Datamuse";
const BASE_URL = "https://api.datamuse.com/words";
const TIMEOUT_MS = 20_000;

type DatamuseWord = {
  word?: unknown;
  defs?: unknown;
  tags?: unknown;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanWhitespace).filter(Boolean)
    : [];
}
async function getJson(url: string, word: string, stage: string): Promise<unknown[] | null> {
  try {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(url, { timeoutMs: TIMEOUT_MS });
    if (!response.ok) {
      console.error("[vox:dictionary] Datamuse HTTP failure", {
        word, stage, status: response.status, statusText: response.statusText,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }
    const json = await response.json().catch(() => null);
    console.log("[vox:dictionary] Datamuse success", {
      word, stage, durationMs: Date.now() - startedAt,
    });
    return Array.isArray(json) ? json : null;
  } catch (error) {
    console.error("[vox:dictionary] Datamuse lookup failed", {
      word, stage, message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function relation(word: string, code: string): Promise<string[]> {
  const params = new URLSearchParams({ ["rel_" + code]: word, max: "12" });
  const rows = await getJson(BASE_URL + "?" + params, word, "rel_" + code);
  return (rows ?? [])
    .map((row) => cleanWhitespace((row as DatamuseWord)?.word))
    .filter(looksLikeTerm);
}
export async function fetchDatamuse(word: string): Promise<AdapterResult | null> {
  const cleaned = word.trim().toLowerCase();
  if (!cleaned) return null;

  const params = new URLSearchParams({ sp: cleaned, qe: "sp", md: "dpr", ipa: "1", max: "1" });
  const [metadataRows, synonyms, antonyms, broader, narrower] = await Promise.all([
    getJson(BASE_URL + "?" + params, cleaned, "metadata"),
    relation(cleaned, "syn"),
    relation(cleaned, "ant"),
    relation(cleaned, "spc"),
    relation(cleaned, "gen"),
  ]);

  const exact = (metadataRows ?? []).find(
    (row) => cleanWhitespace((row as DatamuseWord)?.word).toLowerCase() === cleaned,
  ) as DatamuseWord | undefined;
  const tags = strings(exact?.tags);
  const defs = strings(exact?.defs);
  const partsOfSpeech = tags.filter((tag) => ["n", "v", "adj", "adv"].includes(tag));
  const ipa = tags
    .filter((tag) => tag.startsWith("pron:"))
    .map((tag) => cleanWhitespace(tag.slice(5)));
  const definitions = defs.map((def) => {
    const separator = def.indexOf("\t");
    return separator >= 0 ? cleanWhitespace(def.slice(separator + 1)) : cleanWhitespace(def);
  }).filter(Boolean);
  const relatedWords = [...broader, ...narrower];
  const contributed = definitions.length || partsOfSpeech.length || ipa.length ||
    synonyms.length || antonyms.length || relatedWords.length;
  if (!contributed) return null;

  return {
    source: { name: SOURCE_NAME, url: "https://www.datamuse.com/api/" },
    partsOfSpeech,
    ipa,
    writtenPronunciation: [],
    definitions,
    examples: [],
    synonyms,
    antonyms,
    relatedWords,
    origin: "",
  };
}
