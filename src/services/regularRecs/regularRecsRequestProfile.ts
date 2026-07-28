//
//  regularRecsRequestProfile.ts
//  Request classification + profile building for the REGULAR engine.
//

import {
  REGULAR_GROQ_MAX_TOKENS_ANALYZE,
  REGULAR_GROQ_TEMPERATURE_ANALYZE,
  REGULAR_TTL_PROFILE,
} from "./regularRecsConfig";
import { regularRecsCache } from "./regularRecsCache";
import { regularGroqChatJson } from "./regularRecsGroq";
import {
  cleanText,
  normalizeKey,
  normalizeTitle,
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

export function regularFallbackProfile(requestText: string): RegularRequestProfile {
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
    keywords: uniqueStrings(requestText.split(/\s+/)).slice(0, 8),
    excludeKeywords: [],
  };
}

function coerceProfile(parsed: unknown, requestText: string): RegularRequestProfile {
  if (!parsed || typeof parsed !== "object") return regularFallbackProfile(requestText);
  const obj = parsed as Record<string, unknown>;
  const rawType = cleanText(obj.requestType).toLowerCase().replace(/[\s-]+/g, "_");
  const requestType: RegularRequestType = isRegularRequestType(rawType)
    ? rawType
    : "natural_language";

  return {
    requestType,
    primaryGenres: toStringArray(obj.primaryGenres, 6),
    subgenres: toStringArray(obj.subgenres, 8),
    audience: cleanText(obj.audience),
    tone: toStringArray(obj.tone, 6),
    moods: toStringArray(obj.moods, 8),
    pacing: toStringArray(obj.pacing, 4),
    themes: toStringArray(obj.themes, 10),
    tropes: toStringArray(obj.tropes, 12),
    romanceLevel: cleanText(obj.romanceLevel),
    darknessLevel: cleanText(obj.darknessLevel),
    preferredPublicationEra: cleanText(obj.preferredPublicationEra),
    keywords: toStringArray(obj.keywords, 12),
    excludeKeywords: toStringArray(obj.excludeKeywords, 8),
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
    seed.description ? `Description: ${seed.description.slice(0, 900)}` : "",
    "",
    `Original reader request: "${requestText}"`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function buildRegularRequestProfile(
  requestText: string,
  seed: RegularSeedBook | null,
): Promise<RegularRequestProfile> {
  const cacheKey = `profile:${normalizeTitle(requestText)}:${seed ? normalizeKey(seed.title, seed.author) : "noseed"}`;
  const cached = regularRecsCache.get<RegularRequestProfile>(cacheKey);
  if (cached) return cached;

  const prompt = `Classify and profile the following book/reading request for similarity matching.

${regularSeedContextBlock(seed, requestText)}

The request may be a specific book, an author, a genre, a subgenre, a trope, a mood, or a natural-language reading request.

Return STRICT JSON only, this exact shape:
{
  "requestType": "specific_book | author | genre | subgenre | trope | mood | natural_language",
  "primaryGenres": [],
  "subgenres": [],
  "audience": "",
  "tone": [],
  "moods": [],
  "pacing": [],
  "themes": [],
  "tropes": [],
  "romanceLevel": "none | low | medium | high",
  "darknessLevel": "light | medium | dark",
  "preferredPublicationEra": "",
  "keywords": [],
  "excludeKeywords": []
}

If a verified seed book is provided, base the profile on that actual book. Do NOT recommend books yet.`;

  try {
    const content = await regularGroqChatJson(
      "You analyze books and reading requests for similarity matching and return strict JSON only.",
      prompt,
      {
        temperature: REGULAR_GROQ_TEMPERATURE_ANALYZE,
        maxTokens: REGULAR_GROQ_MAX_TOKENS_ANALYZE,
      },
    );
    const profile = coerceProfile(parseJsonLoose(content), requestText);
    regularRecsCache.set(cacheKey, profile, REGULAR_TTL_PROFILE);
    return profile;
  } catch (error) {
    console.error("Request profile analysis failed:", error);
    return regularFallbackProfile(requestText);
  }
}
