// Adapter for the Wiktionary (Wikimedia) REST definition endpoint.
// Free/open content (CC BY-SA) with no API key. Supplies additional English
// definitions, parts of speech, and usage examples. Definitions/examples are
// returned as HTML and are stripped to plain text here.

import {
  AdapterResult,
  cleanWhitespace,
  fetchWithTimeout,
  stripHtml,
} from "./dictionaryShared";

const SOURCE_NAME = "Wiktionary";
const BASE_URL = "https://en.wiktionary.org/api/rest_v1/page/definition/";
// Wikimedia asks all clients to send a descriptive User-Agent.
const USER_AGENT =
  "MarklyDictionary/1.0 (https://voxiverse.ink; dictionary lookup)";

interface WiktionaryDefinition {
  definition?: unknown;
  examples?: unknown;
  parsedExamples?: unknown;
}

interface WiktionaryUsage {
  partOfSpeech?: unknown;
  language?: unknown;
  definitions?: unknown;
}

export async function fetchWiktionary(
  word: string,
): Promise<AdapterResult | null> {
  // The structured definition endpoint is case-sensitive: `literary` returns
  // data while `Literary` returns 404. Dictionary lookups should therefore
  // normalize user-entered English words before building the request URL.
  const encoded = encodeURIComponent(word.trim().toLowerCase());
  if (!encoded) return null;

  let english: WiktionaryUsage[] = [];
  try {
    const response = await fetchWithTimeout(`${BASE_URL}${encoded}`, {
      timeoutMs: 20_000,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      console.error("[vox:dictionary] Wiktionary HTTP failure", {
        word,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }
    const json = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!json || typeof json !== "object") return null;
    const en = (json as Record<string, unknown>).en;
    if (!Array.isArray(en)) return null;
    english = en as WiktionaryUsage[];
  } catch (error) {
    console.error("[vox:dictionary] Wiktionary lookup failed", {
      word,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const partsOfSpeech: string[] = [];
  const definitions: string[] = [];
  const examples: string[] = [];

  for (const usage of english) {
    const pos = cleanWhitespace(usage?.partOfSpeech);
    if (pos) partsOfSpeech.push(pos);

    if (Array.isArray(usage?.definitions)) {
      for (const def of usage.definitions as WiktionaryDefinition[]) {
        const definition = stripHtml(def?.definition);
        if (definition) definitions.push(definition);

        if (Array.isArray(def?.examples)) {
          for (const example of def.examples) {
            const cleaned = stripHtml(example);
            if (cleaned) examples.push(cleaned);
          }
        }
        if (Array.isArray(def?.parsedExamples)) {
          for (const parsed of def.parsedExamples as Array<{ example?: unknown }>) {
            const cleaned = stripHtml(parsed?.example);
            if (cleaned) examples.push(cleaned);
          }
        }
      }
    }
  }

  const contributed =
    partsOfSpeech.length > 0 || definitions.length > 0 || examples.length > 0;
  if (!contributed) return null;

  return {
    source: { name: SOURCE_NAME, url: `https://en.wiktionary.org/wiki/${encoded}` },
    partsOfSpeech,
    ipa: [],
    writtenPronunciation: [],
    definitions,
    examples,
    synonyms: [],
    antonyms: [],
    relatedWords: [],
    origin: "",
  };
}
