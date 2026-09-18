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
import { generateDictionaryMissingFields } from "./generateDictionaryMissingFields";

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
  const providerWrittenPronunciation = dedupeStrings(writtenCandidates, 1)[0] ?? "";

  // Build the concise context shared with the Groq enrichments.
  const aiContext = {
    word: cleanedWord,
    partOfSpeech,
    definitions,
  };

  // Space the Groq requests out so they do not all hit the provider at once.
  // Each enrichment remains best-effort and cannot fail the overall lookup.
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const usageNotes =
    definitions.length > 0 || partOfSpeech
      ? await generateDictionaryUsageNotes(aiContext)
      : [];

  await sleep(1500);

  const aiExampleSentences =
    definitions.length > 0 || partOfSpeech
      ? await generateDictionaryExampleSentences({
          ...aiContext,
          existingExamples: dictionaryExamples,
        })
      : [];

  await sleep(1500);

  const missingFields = await generateDictionaryMissingFields({
    word: cleanedWord,
    partOfSpeech,
    writtenPronunciation: providerWrittenPronunciation,
    ipaPronunciation,
    definitions,
    examples: dictionaryExamples,
    synonyms,
    antonyms,
    originEtymology: origin,
    relatedWords,
  });

  if (!synonyms.length) synonyms = missingFields.synonyms;
  if (!antonyms.length) antonyms = missingFields.antonyms;
  if (!origin) origin = missingFields.originEtymology;
  if (!relatedWords.length) relatedWords = missingFields.relatedWords;

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
    writtenPronunciation: missingFields.writtenPronunciation,
    ipaPronunciation,
    synonyms,
    antonyms,
    definitions,
    exampleSentences,
    originEtymology: origin,
    relatedWords,
    usageNotes,
    tags: missingFields.tags,
  };
}
