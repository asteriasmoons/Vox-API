//
//  regularRecsCandidates.ts
//  AI candidate generation + early deduplication for the REGULAR engine.
//
//  IMPORTANT: candidate generation uses a SINGLE Groq call (plus an optional
//  fallback call) so we never burst many requests at once and trip Groq's
//  tokens-per-minute rate limit. Books are still tagged by candidate group.
//

import { regularGroqChatJson } from "./regularRecsGroq";
import { regularSeedContextBlock } from "./regularRecsRequestProfile";
import {
  cleanText,
  normalizeKey,
  normalizeTitle,
  parseJsonLoose,
  toStringArray,
} from "./regularRecsUtils";
import {
  REGULAR_CANDIDATE_GROUP_BONUS,
  REGULAR_CANDIDATE_GROUPS,
  type RegularAiCandidate,
  type RegularCandidateGroup,
  type RegularRequestProfile,
  type RegularSeedBook,
} from "./regularRecsTypes";

const REGULAR_CANDIDATE_GROUP_SET = new Set<string>(REGULAR_CANDIDATE_GROUPS);

function coerceCandidateGroup(
  value: unknown,
  fallback: RegularCandidateGroup,
): RegularCandidateGroup {
  const raw = cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
  return REGULAR_CANDIDATE_GROUP_SET.has(raw) ? (raw as RegularCandidateGroup) : fallback;
}

function profileBlock(profile: RegularRequestProfile): string {
  return [
    `Request type: ${profile.requestType}`,
    `Primary genres: ${profile.primaryGenres.join(", ") || "unspecified"}`,
    `Subgenres: ${profile.subgenres.join(", ") || "unspecified"}`,
    `Audience: ${profile.audience || "unspecified"}`,
    `Tone: ${profile.tone.join(", ") || "unspecified"}`,
    `Moods: ${profile.moods.join(", ") || "unspecified"}`,
    `Pacing: ${profile.pacing.join(", ") || "unspecified"}`,
    `Themes: ${profile.themes.join(", ") || "unspecified"}`,
    `Tropes: ${profile.tropes.join(", ") || "unspecified"}`,
    `Romance level: ${profile.romanceLevel || "unspecified"}`,
    `Darkness level: ${profile.darknessLevel || "unspecified"}`,
    `Keywords: ${profile.keywords.join(", ") || "none"}`,
    `Exclude: ${profile.excludeKeywords.join(", ") || "none"}`,
  ].join("\n");
}

function parseAiCandidates(
  raw: string,
  fallbackGroup: RegularCandidateGroup,
): RegularAiCandidate[] {
  const parsed = parseJsonLoose(raw);
  const books = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).books
      : null;
  if (!Array.isArray(books)) return [];

  const out: RegularAiCandidate[] = [];
  for (const entry of books) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const title = cleanText(obj.title);
    if (!title) continue;
    out.push({
      title,
      author: cleanText(obj.author),
      reason: cleanText(obj.reason) || undefined,
      matchTags: toStringArray(obj.matchTags, 8),
      candidateGroup: coerceCandidateGroup(obj.candidateGroup, fallbackGroup),
    });
  }
  return out;
}

const GROUP_GUIDE = [
  '- "closest": the closest possible matches in genre, subgenre, tone, audience, themes, pacing, tropes.',
  '- "reader_safe": reliable, well-known, widely loved books that still closely match.',
  '- "hidden_gem": less obvious, under-the-radar books that still strongly match.',
  '- "recent_release": strongly relevant books from roughly the last 5 years.',
  '- "backlist": older (5+ years) books that remain highly relevant.',
  '- "adjacent": books that differ slightly in one dimension but still fit the taste.',
].join("\n");

// One combined Groq call for the whole candidate pool (no burst of requests).
export async function generateAllRegularCandidates(
  requestText: string,
  seed: RegularSeedBook | null,
  profile: RegularRequestProfile,
): Promise<RegularAiCandidate[]> {
  const prompt = `You are Lumey's book similarity engine.

${regularSeedContextBlock(seed, requestText)}

Similarity profile:
${profileBlock(profile)}

Recommend 48 real, published books that match this request, spread across these candidate groups (roughly 8 per group):
${GROUP_GUIDE}

Rules:
- Only real published books. Never invent titles.
- Do NOT recommend the seed book or alternate editions of it.
- No duplicate titles.
- Keep the audience category appropriate (YA, New Adult, Adult, etc.).
- Prioritize exact subgenre and tonal matches over generic popularity.
- Do not fill the list with unrelated bestsellers.
- Include both newer and older relevant books.
- Give each book an accurate title and author, and tag its candidateGroup.

Return STRICT JSON only:
{"books":[{"title":"","author":"","reason":"short internal relevance reason","matchTags":["tag1","tag2"],"candidateGroup":"closest"}]}`;

  try {
    const content = await regularGroqChatJson(
      "You recommend real published books and return strict JSON only. No markdown, no prose, no summaries.",
      prompt,
      { temperature: 0.35, maxTokens: 6000 },
    );
    return parseAiCandidates(content, "closest");
  } catch (error) {
    console.error("Candidate generation failed:", error);
    return [];
  }
}

function candidatePriority(candidate: RegularAiCandidate): number {
  let score = REGULAR_CANDIDATE_GROUP_BONUS[candidate.candidateGroup];
  if (candidate.author) score += 10;
  if (candidate.reason) score += 4;
  score += Math.min(candidate.matchTags.length, 5);
  return score;
}

export function dedupeRegularCandidates(
  candidates: RegularAiCandidate[],
  seed: RegularSeedBook | null,
): RegularAiCandidate[] {
  const seedKey = seed ? normalizeKey(seed.title, seed.author) : "";
  const seedTitle = seed ? normalizeTitle(seed.title) : "";
  const best = new Map<string, RegularAiCandidate>();

  for (const candidate of candidates) {
    if (!candidate.title) continue;
    const key = normalizeKey(candidate.title, candidate.author);
    if (seedKey && (key === seedKey || normalizeTitle(candidate.title) === seedTitle)) {
      continue;
    }
    const existing = best.get(key);
    if (!existing || candidatePriority(candidate) > candidatePriority(existing)) {
      best.set(key, candidate);
    }
  }

  return [...best.values()];
}

// Optional single extra Groq call when verification leaves us too thin.
export async function generateRegularFallbackCandidates(
  requestText: string,
  seed: RegularSeedBook | null,
  profile: RegularRequestProfile,
  alreadyTried: RegularAiCandidate[],
): Promise<RegularAiCandidate[]> {
  const attempted = alreadyTried
    .slice(0, 60)
    .map((c) => `${c.title}${c.author ? ` by ${c.author}` : ""}`)
    .join("; ");

  const prompt = `You are Lumey's book similarity engine. Provide MORE real books for this request.

${regularSeedContextBlock(seed, requestText)}

Similarity profile:
${profileBlock(profile)}

Recommend 40 additional real, published books that fit this request.
Do NOT repeat any of these already-tried titles: ${attempted || "none"}.
Do NOT recommend the seed book or its alternate editions. Only real books.

Return STRICT JSON only:
{"books":[{"title":"","author":"","reason":"","matchTags":[],"candidateGroup":"closest"}]}`;

  try {
    const content = await regularGroqChatJson(
      "You recommend real published books and return strict JSON only.",
      prompt,
      { temperature: 0.35, maxTokens: 6000 },
    );
    return parseAiCandidates(content, "closest");
  } catch (error) {
    console.error("Fallback candidate pass failed:", error);
    return [];
  }
}
