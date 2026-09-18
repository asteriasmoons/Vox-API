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
import { fetchWiktionary } from "./dictionaryWiktionaryAdapter";
import { fetchDatamuse } from "./dictionaryDatamuseAdapter";
import { fetchMerriamWebster } from "./dictionaryMerriamWebsterAdapter";
import { groqDictionaryFetch } from "./groqDictionaryFetch";

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

// Accept only actual IPA-looking pronunciation candidates. Plain English
// respellings and provider-specific alphabetic pronunciation codes must never
// be returned in Markly's IPA field.
function pickIpa(candidates: string[]): string {
  const cleaned = dedupeStrings(candidates, MAX_IPA_CANDIDATES);
  const ipaLike = cleaned.find((c) => /[ˈˌːɪʊəɚɝæɑɒɔɛɜʌʃʒθðŋɡɹɾʔ]/.test(c));
  return ipaLike ?? "";
}

export async function aggregateWordDetails(
  word: string,
): Promise<NormalizedWordDetails> {
  const cleanedWord = cleanWhitespace(word);

  // All reference sources are independent. A slow/unavailable provider must not
  // prevent the other sources from contributing to the word record.
  const settled = await Promise.allSettled([
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

  // One Groq round trip enriches every AI-backed field.
  const enrichment = await groqDictionaryFetch({
    word: cleanedWord,
    partOfSpeech,
    providerWrittenPronunciation,
    ipaPronunciation,
    definitions,
    existingExamples: dictionaryExamples,
    synonyms,
    antonyms,
    originEtymology: origin,
    relatedWords,
  });

  if (!synonyms.length) synonyms = enrichment.synonyms;
  if (!antonyms.length) antonyms = enrichment.antonyms;
  if (!origin) origin = enrichment.originEtymology;
  if (!relatedWords.length) relatedWords = enrichment.relatedWords;

  // Prefer AI-generated example sentences; fall back to genuine dictionary
  // examples if the AI produced none.
  const exampleSentences =
    enrichment.exampleSentences.length > 0
      ? enrichment.exampleSentences
      : dedupeStrings(dictionaryExamples, 3);

  return {
    word: cleanedWord,
    partOfSpeech,
    sources: dedupeSources(sources),
    writtenPronunciation: enrichment.writtenPronunciation,
    ipaPronunciation: enrichment.ipaPronunciation || ipaPronunciation,
    synonyms,
    antonyms,
    definitions,
    exampleSentences,
    originEtymology: origin,
    relatedWords,
    usageNotes: enrichment.usageNotes,
    tags: enrichment.tags,
  };
}
