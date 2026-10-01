// Single Groq enrichment for Markly dictionary Fetch Details.
import { groqChatJson } from "./groqAIClient";
import {
  cleanWhitespace,
  dedupeStrings,
  looksLikeTerm,
  mapPartOfSpeech,
  NormalizedUsageNote,
} from "./dictionaryShared";

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
  partOfSpeech: string;
  definitions: string[];
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
  partOfSpeech: "", definitions: [],
  exampleSentences: [], usageNotes: [], synonyms: [], antonyms: [],
  originEtymology: "", relatedWords: [], writtenPronunciation: "",
  ipaPronunciation: "", tags: [],
});

function capitalizeWords(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function list(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return dedupeStrings(
    value.map(cleanWhitespace).filter(looksLikeTerm).map(capitalizeWords),
    limit,
  );
}

function textList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return dedupeStrings(value.map(cleanWhitespace).filter(Boolean), limit);
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

function missingRequiredFields(
  result: GroqDictionaryResult,
  context: GroqDictionaryContext,
): string[] {
  const missing: string[] = [];
  if (!context.partOfSpeech && !result.partOfSpeech) missing.push("partOfSpeech");
  if (!context.definitions.length && !result.definitions.length) missing.push("definitions");
  if (!result.exampleSentences.length) missing.push("exampleSentences");
  if (!result.usageNotes.length) missing.push("usageNotes");
  if (!context.synonyms.length && !result.synonyms.length) missing.push("synonyms");
  if (!context.antonyms.length && !result.antonyms.length) missing.push("antonyms");
  if (!context.originEtymology && !result.originEtymology) missing.push("originEtymology");
  if (!context.relatedWords.length && !result.relatedWords.length) missing.push("relatedWords");
  if (!result.writtenPronunciation) missing.push("writtenPronunciation");
  if (!result.ipaPronunciation && !context.ipaPronunciation) missing.push("ipaPronunciation");
  if (!result.tags.length) missing.push("tags");
  return missing;
}

function systemPrompt(): string {
  return `You enrich a personal dictionary record. Return only valid JSON with exactly these keys:
{"partOfSpeech":"","definitions":[],"exampleSentences":[],"usageNotes":[],"synonyms":[],"antonyms":[],"originEtymology":"","relatedWords":[],"writtenPronunciation":"","ipaPronunciation":"","tags":[]}

COMPLETENESS IS REQUIRED:
The external dictionary providers may have missed fields. You MUST supply a useful, accurate fallback for EVERY field whose existing value is empty. Never return an empty string or empty array for a missing field. Definitions are mandatory: when Existing definitions is empty, return 1-3 concise dictionary definitions for the requested word. Return partOfSpeech as exactly one of Noun, Verb, Adjective, Adverb, Pronoun, or Preposition. If the existing part of speech is empty, infer the best fit for the supplied meaning. Even when a word has no strict antonym, provide a useful conceptual contrast. Do not omit a field merely because an external source did not provide it.

USAGE NOTES — preserve this meaning carefully:
A usage note is a short Label/Value pair describing HOW a word is used: its register, tone, connotation, formality, typical context, or common restriction. It is NOT a definition, synonym, or example sentence.
Return 1-2 usage notes.
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
Only supply partOfSpeech, definitions, synonyms, antonyms, originEtymology, or relatedWords when the corresponding existing field is empty; otherwise return the existing value unchanged. Use careful, conservative wording when exact etymology is uncertain, but do not leave the field empty.
Always generate useful short organizational tags from the word and supplied context. Every array must contain at least one useful item.`;
}
export async function groqDictionaryFetch(c: GroqDictionaryContext): Promise<GroqDictionaryResult> {
  const baseUserPrompt = [
    `Word: ${c.word}`, `Part of speech: ${c.partOfSpeech}`,
    `Definitions: ${JSON.stringify(c.definitions)}`,
    `Existing examples: ${JSON.stringify(c.existingExamples)}`,
    `Provider pronunciation notation: ${c.providerWrittenPronunciation}`,
    `Existing IPA: ${c.ipaPronunciation}`,
    `Existing synonyms: ${JSON.stringify(c.synonyms)}`,
    `Existing antonyms: ${JSON.stringify(c.antonyms)}`,
    `Existing etymology: ${c.originEtymology}`,
    `Existing related words: ${JSON.stringify(c.relatedWords)}`,
    "Return the complete enrichment JSON. Do not leave any missing field empty."
  ].join("\n");

  try {
    let lastResult = emptyResult();
    let missing: string[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repairInstruction = missing.length
        ? `\nYour previous response was incomplete. These fields were empty or invalid: ${missing.join(", ")}. Return the entire JSON again with every listed field populated.`
        : "";
      const raw = await groqChatJson(systemPrompt(), baseUserPrompt + repairInstruction, {
        stage: attempt === 0 ? "dictionary-fetch" : "dictionary-fetch-repair",
        model: MODEL,
        temperature: 0.25,
        maxTokens: MAX_OUTPUT_TOKENS,
      });
      const p = parse(raw);
      if (!p) {
        missing = ["valid JSON response"];
        continue;
      }

      const rawWritten = cleanWhitespace(p.writtenPronunciation).toLowerCase();
      const writtenPronunciation = /^[a-z]+(?:-[a-z]+)*$/.test(rawWritten) ? rawWritten : "";
      const ipaPronunciation = cleanWhitespace(p.ipaPronunciation);
      const examples = Array.isArray(p.exampleSentences)
        ? dedupeStrings(p.exampleSentences.map(cleanWhitespace), 3) : [];

      lastResult = {
        partOfSpeech: c.partOfSpeech || mapPartOfSpeech(cleanWhitespace(p.partOfSpeech)),
        definitions: c.definitions.length ? [] : textList(p.definitions, 6),
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
      missing = missingRequiredFields(lastResult, c);
      if (!missing.length) return lastResult;
    }

    console.error("[vox:dictionary] Groq enrichment remained incomplete", {
      word: c.word,
      missing,
    });
    return lastResult;
  } catch (error) {
    console.error("[vox:dictionary] combined Groq enrichment failed", {
      word: c.word,
      message: error instanceof Error ? error.message : String(error),
    });
    return emptyResult();
  }
}
