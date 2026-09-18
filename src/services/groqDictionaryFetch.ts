// Single Groq enrichment for Markly dictionary Fetch Details.
import { groqChatJson } from "./groqAIClient";
import { cleanWhitespace, dedupeStrings, looksLikeTerm, NormalizedUsageNote } from "./dictionaryShared";

const MODEL = "openai/gpt-oss-120b";
const MAX_OUTPUT_TOKENS = 1800;

export interface GroqDictionaryContext {
  word: string;
  partOfSpeech: string;
  providerWrittenPronunciation: string;
  ipaPronunciation: string;
  definitions: string[];
  existingExamples: string[];
  synonyms: string[];
  antonyms: string[];
  originEtymology: string;
  relatedWords: string[];
}

export interface GroqDictionaryResult {
  exampleSentences: string[];
  usageNotes: NormalizedUsageNote[];
  synonyms: string[];
  antonyms: string[];
  originEtymology: string;
  relatedWords: string[];
  writtenPronunciation: string;
  ipaPronunciation: string;
  tags: string[];
}
const emptyResult = (): GroqDictionaryResult => ({
  exampleSentences: [], usageNotes: [], synonyms: [], antonyms: [],
  originEtymology: "", relatedWords: [], writtenPronunciation: "",
  ipaPronunciation: "", tags: [],
});

function list(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return dedupeStrings(value.map(cleanWhitespace).filter(looksLikeTerm), limit);
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw.trim());
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function usageNotes(value: unknown): NormalizedUsageNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const label = cleanWhitespace(row.label);
    const noteValue = cleanWhitespace(row.value);
    return label && noteValue ? [{ label, value: noteValue }] : [];
  }).slice(0, 2);
}
function systemPrompt(): string {
  return `You enrich a personal dictionary record. Return only valid JSON with exactly these keys:
{"exampleSentences":[],"usageNotes":[],"synonyms":[],"antonyms":[],"originEtymology":"","relatedWords":[],"writtenPronunciation":"","ipaPronunciation":"","tags":[]}

USAGE NOTES — preserve this meaning carefully:
A usage note is a short Label/Value pair describing HOW a word is used: its register, tone, connotation, formality, typical context, or common restriction. It is NOT a definition, synonym, or example sentence.
Return at most 2 usage notes. Fewer is fine.
Label: 1-2 words naming the aspect (e.g. Formal, Slang, Technical, Appreciative).
Value: one clear sentence describing the usage. No definitions and no example sentences.
Two examples of the intended Label/Value relationship:
{"label":"Formal","value":"Commonly used as a more formal or literary term for a person with a strong love of books or an enthusiasm for collecting them."}
{"label":"Appreciative","value":"Usually carries a positive tone, suggesting genuine affection for books and often an appreciation of their physical, artistic, or collectible qualities."}

EXAMPLE SENTENCES:
Return at most 3 natural sentences. Each must use the word correctly for its supplied meaning and part of speech. Show realistic usage; do not merely restate a definition.

PRONUNCIATION:
Always generate writtenPronunciation as simple English phonetic respelling using ONLY A-Z letters and hyphens, e.g. fay-buhl. No spaces, stress marks, digits, slashes, IPA symbols, or dictionary codes.
If supplied ipaPronunciation is genuine IPA, return it unchanged. If it is empty, generate genuine IPA for the word. ipaPronunciation must be actual IPA, never English respelling, ARPABET, or Merriam-Webster notation.

OTHER FIELDS:
Only supply synonyms, antonyms, originEtymology, or relatedWords when the corresponding existing field is empty. Leave uncertain factual fields empty.
Always generate useful short organizational tags from the word and supplied context.`;
}
export async function groqDictionaryFetch(c: GroqDictionaryContext): Promise<GroqDictionaryResult> {
  const userPrompt = [
    `Word: ${c.word}`, `Part of speech: ${c.partOfSpeech}`,
    `Definitions: ${JSON.stringify(c.definitions)}`,
    `Existing examples: ${JSON.stringify(c.existingExamples)}`,
    `Provider pronunciation notation: ${c.providerWrittenPronunciation}`,
    `Existing IPA: ${c.ipaPronunciation}`,
    `Existing synonyms: ${JSON.stringify(c.synonyms)}`,
    `Existing antonyms: ${JSON.stringify(c.antonyms)}`,
    `Existing etymology: ${c.originEtymology}`,
    `Existing related words: ${JSON.stringify(c.relatedWords)}`,
    "Return the complete enrichment JSON."
  ].join("\n");

  try {
    const raw = await groqChatJson(systemPrompt(), userPrompt, {
      stage: "dictionary-fetch", model: MODEL, temperature: 0.25,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    const p = parse(raw);
    if (!p) return emptyResult();

    const rawWritten = cleanWhitespace(p.writtenPronunciation).toLowerCase();
    const writtenPronunciation = /^[a-z]+(?:-[a-z]+)*$/.test(rawWritten) ? rawWritten : "";
    const ipaPronunciation = cleanWhitespace(p.ipaPronunciation);

    const examples = Array.isArray(p.exampleSentences)
      ? dedupeStrings(p.exampleSentences.map(cleanWhitespace), 3) : [];

    return {
      exampleSentences: examples,
      usageNotes: usageNotes(p.usageNotes),
      synonyms: c.synonyms.length ? [] : list(p.synonyms, 12),
      antonyms: c.antonyms.length ? [] : list(p.antonyms, 12),
      originEtymology: c.originEtymology ? "" : cleanWhitespace(p.originEtymology),
      relatedWords: c.relatedWords.length ? [] : list(p.relatedWords, 12),
      writtenPronunciation,
      ipaPronunciation,
      tags: list(p.tags, 8),
    };
  } catch (error) {
    console.error("[vox:dictionary] combined Groq enrichment failed", {
      word: c.word,
      message: error instanceof Error ? error.message : String(error),
    });
    return emptyResult();
  }
}
