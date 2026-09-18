// Adapter for the Free Dictionary API (https://dictionaryapi.dev).
// Free, open, no API key, usable in a distributed app. Supplies IPA, part of
// speech, definitions, examples, synonyms, antonyms, and (occasionally) origin.

import {
  AdapterResult,
  cleanWhitespace,
  fetchWithTimeout,
  looksLikeTerm,
} from "./dictionaryShared";

const SOURCE_NAME = "Free Dictionary";
const BASE_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";

interface FreeDictionaryDefinition {
  definition?: unknown;
  example?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
}

interface FreeDictionaryMeaning {
  partOfSpeech?: unknown;
  definitions?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
}

interface FreeDictionaryPhonetic {
  text?: unknown;
}

interface FreeDictionaryEntry {
  word?: unknown;
  phonetic?: unknown;
  phonetics?: unknown;
  origin?: unknown;
  meanings?: unknown;
  sourceUrls?: unknown;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanWhitespace(item))
    .filter((item) => item.length > 0);
}

export async function fetchFreeDictionary(
  word: string,
): Promise<AdapterResult | null> {
  const encoded = encodeURIComponent(word.trim().toLowerCase());
  if (!encoded) return null;

  let entries: FreeDictionaryEntry[] = [];
  try {
    const response = await fetchWithTimeout(`${BASE_URL}${encoded}`, {
      timeoutMs: 7_000,
    });
    if (!response.ok) {
      // 404 => word not found at this source; treated as "no contribution".
      return null;
    }
    const json = (await response.json().catch(() => null)) as unknown;
    if (!Array.isArray(json)) return null;
    entries = json as FreeDictionaryEntry[];
  } catch (error) {
    console.error("[vox:dictionary] Free Dictionary lookup failed", {
      word,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const partsOfSpeech: string[] = [];
  const ipa: string[] = [];
  const definitions: string[] = [];
  const examples: string[] = [];
  const synonyms: string[] = [];
  const antonyms: string[] = [];
  let origin = "";
  let sourceUrl = `https://dictionaryapi.dev`;

  for (const entry of entries) {
    if (typeof entry?.phonetic === "string") {
      const text = cleanWhitespace(entry.phonetic);
      if (text) ipa.push(text);
    }
    if (Array.isArray(entry?.phonetics)) {
      for (const phonetic of entry.phonetics as FreeDictionaryPhonetic[]) {
        const text = cleanWhitespace(phonetic?.text);
        if (text) ipa.push(text);
      }
    }
    if (!origin && typeof entry?.origin === "string") {
      origin = cleanWhitespace(entry.origin);
    }
    const firstUrl = stringArray(entry?.sourceUrls)[0];
    if (firstUrl) sourceUrl = firstUrl;

    if (Array.isArray(entry?.meanings)) {
      for (const meaning of entry.meanings as FreeDictionaryMeaning[]) {
        const pos = cleanWhitespace(meaning?.partOfSpeech);
        if (pos) partsOfSpeech.push(pos);

        for (const syn of stringArray(meaning?.synonyms)) {
          if (looksLikeTerm(syn)) synonyms.push(syn);
        }
        for (const ant of stringArray(meaning?.antonyms)) {
          if (looksLikeTerm(ant)) antonyms.push(ant);
        }

        if (Array.isArray(meaning?.definitions)) {
          for (const def of meaning.definitions as FreeDictionaryDefinition[]) {
            const definition = cleanWhitespace(def?.definition);
            if (definition) definitions.push(definition);
            const example = cleanWhitespace(def?.example);
            if (example) examples.push(example);
            for (const syn of stringArray(def?.synonyms)) {
              if (looksLikeTerm(syn)) synonyms.push(syn);
            }
            for (const ant of stringArray(def?.antonyms)) {
              if (looksLikeTerm(ant)) antonyms.push(ant);
            }
          }
        }
      }
    }
  }

  const contributed =
    partsOfSpeech.length > 0 ||
    ipa.length > 0 ||
    definitions.length > 0 ||
    examples.length > 0 ||
    synonyms.length > 0 ||
    antonyms.length > 0 ||
    origin.length > 0;

  if (!contributed) return null;

  return {
    source: { name: SOURCE_NAME, url: sourceUrl },
    partsOfSpeech,
    ipa,
    writtenPronunciation: [],
    definitions,
    examples,
    synonyms,
    antonyms,
    relatedWords: [],
    origin,
  };
}
