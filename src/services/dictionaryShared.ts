// Shared types and helpers for the multi-source dictionary word lookup feature.
// Third-party adapters normalize their raw responses into `AdapterResult`,
// the aggregator merges those into a single `NormalizedWordDetails` that Markly
// decodes and maps onto the existing DictionaryWord form fields.

export interface NormalizedSource {
  name: string;
  url: string;
}

export interface NormalizedUsageNote {
  label: string;
  value: string;
}

// The final structured payload returned to Markly. Field names mirror the
// existing Markly DictionaryWord model so the client can map them directly.
export interface NormalizedWordDetails {
  word: string;
  partOfSpeech: string;
  sources: NormalizedSource[];
  writtenPronunciation: string;
  ipaPronunciation: string;
  synonyms: string[];
  antonyms: string[];
  definitions: string[];
  exampleSentences: string[];
  originEtymology: string;
  relatedWords: string[];
  usageNotes: NormalizedUsageNote[];
  tags: string[];
}

// What each third-party adapter contributes. Anything a source does not
// genuinely supply is simply left empty — never fabricated.
export interface AdapterResult {
  source: NormalizedSource;
  partsOfSpeech: string[];
  ipa: string[];
  writtenPronunciation: string[];
  definitions: string[];
  examples: string[];
  synonyms: string[];
  antonyms: string[];
  relatedWords: string[];
  origin: string;
}

export const MARKLY_PARTS_OF_SPEECH = [
  "Noun",
  "Verb",
  "Adjective",
  "Adverb",
  "Pronoun",
  "Preposition",
] as const;

const PART_OF_SPEECH_MAP: Record<string, string> = {
  noun: "Noun",
  nouns: "Noun",
  n: "Noun",
  verb: "Verb",
  verbs: "Verb",
  v: "Verb",
  adjective: "Adjective",
  adj: "Adjective",
  adverb: "Adverb",
  adv: "Adverb",
  pronoun: "Pronoun",
  pron: "Pronoun",
  preposition: "Preposition",
  prep: "Preposition",
};

// Map an arbitrary third-party part-of-speech string onto one of Markly's
// allowed values. Returns "" when it cannot be safely mapped so the form keeps
// its current selection rather than showing an invalid value.
export function mapPartOfSpeech(raw: string): string {
  const key = cleanWhitespace(raw).toLowerCase();
  if (!key) return "";
  return PART_OF_SPEECH_MAP[key] ?? "";
}

export function pickPartOfSpeech(rawValues: string[]): string {
  for (const raw of rawValues) {
    const mapped = mapPartOfSpeech(raw);
    if (mapped) return mapped;
  }
  return "";
}

export function cleanWhitespace(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

// Strip HTML tags (Wiktionary definitions/examples are HTML) and decode a few
// common entities, then collapse whitespace.
export function stripHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  const withoutTags = value.replace(/<[^>]*>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
  return cleanWhitespace(decoded);
}

// Deduplicate a list of strings case-insensitively while preserving the first
// occurrence's original casing/spelling. Optionally cap the result length.
export function dedupeStrings(values: string[], limit?: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const cleaned = cleanWhitespace(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (limit && out.length >= limit) break;
  }
  return out;
}

// A single-word sanity check used to keep synonym/antonym/related lists clean
// (dictionary APIs occasionally return phrases or notes in those arrays).
export function looksLikeTerm(value: string): boolean {
  const cleaned = cleanWhitespace(value);
  if (!cleaned || cleaned.length > 40) return false;
  return true;
}

// fetch with an abort-based timeout so a slow/unavailable source cannot hang
// the whole aggregation.
export async function fetchWithTimeout(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const init: RequestInit = {
      method: "GET",
      signal: controller.signal,
    };
    if (options.headers) {
      init.headers = options.headers;
    }
    return await fetch(url, init);
  } finally {
    clearTimeout(timeout);
  }
}
