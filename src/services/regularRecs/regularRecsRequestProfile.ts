//
//  regularRecsRequestProfile.ts
//  Request classification + profile for the REGULAR engine.
//
//  The AI profile runs on MISTRAL (not Groq) so it never competes with Groq's
//  per-minute token budget. Falls back to a heuristic profile if Mistral fails.
//

import { regularMistralChatJson } from "./regularRecsProviders";
import {
  cleanText,
  parseJsonLoose,
  toStringArray,
  uniqueStrings,
} from "./regularRecsUtils";
import {
  isRegularRequestType,
  type RegularRequestProfile,
  type RegularRequestType,
  type RegularSeedBook,
} from "./regularRecsTypes";

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with",
  "book", "books", "like", "similar", "recommend", "recommendations",
]);

export function regularFallbackProfile(requestText: string): RegularRequestProfile {
  const keywords = uniqueStrings(
    requestText
      .split(/\s+/)
      .map((w) => cleanText(w))
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase())),
  ).slice(0, 10);

  return {
    requestType: "natural_language",
    primaryGenres: [],
    subgenres: [],
    audience: "",
    tone: [],
    moods: [],
    pacing: [],
    themes: [],
    tropes: [],
    romanceLevel: "",
    darknessLevel: "",
    preferredPublicationEra: "",
    keywords,
    excludeKeywords: [],
  };
}

// Heuristic profile from the resolved seed book, used as a fallback / base.
function heuristicProfile(
  requestText: string,
  seed: RegularSeedBook | null,
): RegularRequestProfile {
  const base = regularFallbackProfile(requestText);
  if (!seed) return base;
  return {
    ...base,
    requestType: "specific_book",
    primaryGenres: toStringArray(seed.subjects, 4),
    subgenres: toStringArray(seed.subjects.slice(4), 6),
    keywords: uniqueStrings([...base.keywords, ...seed.subjects]).slice(0, 12),
  };
}

export function regularSeedContextBlock(
  seed: RegularSeedBook | null,
  requestText: string,
): string {
  if (!seed) {
    return `Reader request (no verified seed book resolved): "${requestText}"`;
  }
  return [
    "Verified seed book (use its ACTUAL qualities):",
    `Title: ${seed.title}`,
    `Author: ${seed.author || "Unknown"}`,
    seed.releaseYear ? `Published: ${seed.releaseYear}` : "",
    seed.subjects.length ? `Subjects/Tags: ${seed.subjects.join(", ")}` : "",
    seed.description ? `Description: ${seed.description.slice(0, 700)}` : "",
    "",
    `Original reader request: "${requestText}"`,
  ]
    .filter(Boolean)
    .join("\n");
}

function coerceProfile(
  parsed: unknown,
  base: RegularRequestProfile,
): RegularRequestProfile {
  if (!parsed || typeof parsed !== "object") return base;
  const obj = parsed as Record<string, unknown>;
  const rawType = cleanText(obj.requestType).toLowerCase().replace(/[\s-]+/g, "_");
  const requestType: RegularRequestType = isRegularRequestType(rawType)
    ? rawType
    : base.requestType;

  const pick = (key: string, fallback: string[], limit: number): string[] => {
    const v = toStringArray(obj[key], limit);
    return v.length ? v : fallback;
  };

  return {
    requestType,
    primaryGenres: pick("primaryGenres", base.primaryGenres, 6),
    subgenres: pick("subgenres", base.subgenres, 8),
    audience: cleanText(obj.audience) || base.audience,
    tone: toStringArray(obj.tone, 6),
    moods: toStringArray(obj.moods, 8),
    pacing: toStringArray(obj.pacing, 4),
    themes: toStringArray(obj.themes, 10),
    tropes: toStringArray(obj.tropes, 12),
    romanceLevel: cleanText(obj.romanceLevel),
    darknessLevel: cleanText(obj.darknessLevel),
    preferredPublicationEra: cleanText(obj.preferredPublicationEra),
    keywords: pick("keywords", base.keywords, 12),
    excludeKeywords: toStringArray(obj.excludeKeywords, 8),
  };
}

// AI profile via Mistral, with a heuristic fallback. Never throws.
export async function buildRegularRequestProfile(
  requestText: string,
  seed: RegularSeedBook | null,
): Promise<RegularRequestProfile> {
  const base = heuristicProfile(requestText, seed);

  const prompt = `Classify and profile this book/reading request for similarity matching.

${regularSeedContextBlock(seed, requestText)}

The request may be a specific book, an author, a genre, a subgenre, a trope, a mood, or a natural-language reading request.

Return STRICT JSON only, this exact shape:
{
  "requestType": "specific_book | author | genre | subgenre | trope | mood | natural_language",
  "primaryGenres": [], "subgenres": [], "audience": "",
  "tone": [], "moods": [], "pacing": [], "themes": [], "tropes": [],
  "romanceLevel": "none | low | medium | high",
  "darknessLevel": "light | medium | dark",
  "preferredPublicationEra": "", "keywords": [], "excludeKeywords": []
}

If a verified seed book is provided, base the profile on that actual book. Do NOT recommend books.`;

  try {
    const content = await regularMistralChatJson(
      "You analyze books and reading requests for similarity matching and return strict JSON only.",
      prompt,
      { temperature: 0.2, maxTokens: 900 },
    );
    return coerceProfile(parseJsonLoose(content), base);
  } catch (error) {
    console.error("Request profile analysis failed (using heuristic):", error);
    return base;
  }
}
