// Aggregator for the multi-source dictionary word lookup.
// Queries the free dictionary/reference adapters in parallel, tolerates partial
// failure, normalizes + deduplicates their results, then enriches with the two
// Groq AI features (usage notes + example sentences) and returns one clean
// NormalizedWordDetails payload for Markly.

import {
  AdapterResult,
  NormalizedWordDetails,
  NormalizedSource,
  cleanWhitespace,
  dedupeStrings,
  pickPartOfSpeech,
} from "./dictionaryShared";
import { fetchFreeDictionary } from "./dictionaryFreeDictionaryAdapter";
import { fetchWiktionary } from "./dictionaryWiktionaryAdapter";
import { fetchDatamuse } from "./dictionaryDatamuseAdapter";
import { fetchMerriamWebster } from "./dictionaryMerriamWebsterAdapter";
import { generateDictionaryUsageNotes } from "./generateDictionaryUsageNotes";
import { generateDictionaryExampleSentences } from "./generateDictionaryExampleSentences";

const MAX_DEFINITIONS = 6;
const MAX_SYNONYMS = 12;
const MAX_ANTONYMS = 12;
const MAX_RELATED = 12;
const MAX_IPA_CANDIDATES = 5;

function dedupeSources(sources: NormalizedSource[]): NormalizedSource[] {
  const seen = new Set<string>();
  const out: NormalizedSource[] = [];
  for (const source of sources) {
    const name = cleanWhitespace(source.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, url: cleanWhitespace(source.url) });
  }
  return out;
}

// Prefer an IPA-looking pronunciation (contains slashes/brackets or IPA glyphs).
function pickIpa(candidates: string[]): string {
  const cleaned = dedupeStrings(candidates, MAX_IPA_CANDIDATES);
  const ipaLike = cleaned.find((c) => /[\/\[].*[\/\]]/.test(c) || /[ˈˌːɪəæʃʒθðŋ]/.test(c));
  return ipaLike ?? cleaned[0] ?? "";
}

export async function aggregateWordDetails(
  word: string,
): Promise<NormalizedWordDetails> {
  const cleanedWord = cleanWhitespace(word);

  // All reference sources are independent. A slow/unavailable provider must not
  // prevent the other sources from contributing to the word record.
  const settled = await Promise.allSettled([
    fetchFreeDictionary(cleanedWord),
    fetchWiktionary(cleanedWord),
    fetchDatamuse(cleanedWord),
    fetchMerriamWebster(cleanedWord),
  ]);

  const results: AdapterResult[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value) {
      results.push(outcome.value);
    }
  }

  // Merge raw contributions from every source that returned data.
  const sources: NormalizedSource[] = [];
  const partsOfSpeech: string[] = [];
  const ipaCandidates: string[] = [];
  const writtenCandidates: string[] = [];
  let definitions: string[] = [];
  let dictionaryExamples: string[] = [];
  let synonyms: string[] = [];
  let antonyms: string[] = [];
  let relatedWords: string[] = [];
  let origin = "";

  for (const result of results) {
    sources.push(result.source);
    partsOfSpeech.push(...result.partsOfSpeech);
    ipaCandidates.push(...result.ipa);
    writtenCandidates.push(...result.writtenPronunciation);
    definitions.push(...result.definitions);
    dictionaryExamples.push(...result.examples);
    synonyms.push(...result.synonyms);
    antonyms.push(...result.antonyms);
    relatedWords.push(...result.relatedWords);
    if (!origin && result.origin) origin = result.origin;
  }

  definitions = dedupeStrings(definitions, MAX_DEFINITIONS);
  dictionaryExamples = dedupeStrings(dictionaryExamples, 6);
  synonyms = dedupeStrings(synonyms, MAX_SYNONYMS);
  antonyms = dedupeStrings(antonyms, MAX_ANTONYMS);
  relatedWords = dedupeStrings(relatedWords, MAX_RELATED);

  const partOfSpeech = pickPartOfSpeech(partsOfSpeech);
  const ipaPronunciation = pickIpa(ipaCandidates);
  const writtenPronunciation = dedupeStrings(writtenCandidates, 1)[0] ?? "";

  // Build the concise context shared with both AI features. Only what the model
  // needs to be accurate — no unnecessary payload for the Groq free plan.
  const aiContext = {
    word: cleanedWord,
    partOfSpeech,
    definitions,
  };

  // Run both AI features in parallel. Each is best-effort and returns [] on
  // failure so the overall lookup still succeeds.
  const [usageNotes, aiExampleSentences] = await Promise.all([
    definitions.length > 0 || partOfSpeech
      ? generateDictionaryUsageNotes(aiContext)
      : Promise.resolve([]),
    definitions.length > 0 || partOfSpeech
      ? generateDictionaryExampleSentences({
          ...aiContext,
          existingExamples: dictionaryExamples,
        })
      : Promise.resolve([]),
  ]);

  // Prefer AI-generated example sentences; fall back to genuine dictionary
  // examples if the AI produced none.
  const exampleSentences =
    aiExampleSentences.length > 0
      ? aiExampleSentences
      : dedupeStrings(dictionaryExamples, 3);

  return {
    word: cleanedWord,
    partOfSpeech,
    sources: dedupeSources(sources),
    writtenPronunciation,
    ipaPronunciation,
    synonyms,
    antonyms,
    definitions,
    exampleSentences,
    originEtymology: origin,
    relatedWords,
    usageNotes,
    tags: [],
  };
}
