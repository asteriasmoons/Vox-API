//
//  regularRecsCandidates.ts
//  Multi-pass AI candidate generation + early deduplication for the REGULAR engine.
//

import {
  REGULAR_CANDIDATES_PER_GROUP,
  REGULAR_GROQ_MAX_TOKENS_RECOMMEND,
  REGULAR_GROQ_TEMPERATURE_RECOMMEND,
} from "./regularRecsConfig";
import { regularGroqChatJson } from "./regularRecsGroq";
import { regularSeedContextBlock } from "./regularRecsRequestProfile";
import {
  cleanText,
  mapWithConcurrency,
  normalizeKey,
  normalizeTitle,
  parseJsonLoose,
  toStringArray,
} from "./regularRecsUtils";
import {
  REGULAR_CANDIDATE_GROUP_BONUS,
  REGULAR_CANDIDATE_GROUP_BRIEF,
  REGULAR_CANDIDATE_GROUPS,
  type RegularAiCandidate,
  type RegularCandidateGroup,
  type RegularRequestProfile,
  type RegularSeedBook,
} from "./regularRecsTypes";

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
  group: RegularCandidateGroup,
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
      candidateGroup: group,
    });
  }
  return out;
}

async function generateCandidateGroup(
  requestText: string,
  seed: RegularSeedBook | null,
  profile: RegularRequestProfile,
  group: RegularCandidateGroup,
): Promise<RegularAiCandidate[]> {
  const prompt = `You are Lumey's book similarity engine. Generate ONE candidate group.

${regularSeedContextBlock(seed, requestText)}

Similarity profile:
${profileBlock(profile)}

Candidate group: "${group}"
Goal for this group: ${REGULAR_CANDIDATE_GROUP_BRIEF[group]}

Recommend ${REGULAR_CANDIDATES_PER_GROUP} real, published books for THIS group only.

Rules:
- Only real published books. Never invent titles.
- Do NOT recommend the seed book or alternate editions of it.
- No duplicate titles.
- Keep the audience category appropriate (YA, New Adult, Adult, etc.).
- Prioritize exact subgenre and tonal matches over generic popularity.
- Do not fill the list with unrelated bestsellers.
- Match the group's intent (e.g. "recent_release" = last ~5 years; "backlist" = older but still relevant).
- Provide accurate title and author.

Return STRICT JSON only:
{"books":[{"title":"","author":"","reason":"short internal relevance reason","matchTags":["tag1","tag2"],"candidateGroup":"${group}"}]}`;

  try {
    const content = await regularGroqChatJson(
      "You recommend real published books and return strict JSON only. No markdown, no prose, no summaries.",
      prompt,
      {
        temperature: REGULAR_GROQ_TEMPERATURE_RECOMMEND,
        maxTokens: REGULAR_GROQ_MAX_TOKENS_RECOMMEND,
      },
    );
    return parseAiCandidates(content, group).slice(0, 35);
  } catch (error) {
    console.error(`Candidate group "${group}" failed:`, error);
    return [];
  }
}

export async function generateAllRegularCandidates(
  requestText: string,
  seed: RegularSeedBook | null,
  profile: RegularRequestProfile,
): Promise<RegularAiCandidate[]> {
  const groups = await mapWithConcurrency(
    REGULAR_CANDIDATE_GROUPS,
    3,
    (group) => generateCandidateGroup(requestText, seed, profile, group),
  );
  return groups.flat();
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
      {
        temperature: REGULAR_GROQ_TEMPERATURE_RECOMMEND,
        maxTokens: REGULAR_GROQ_MAX_TOKENS_RECOMMEND,
      },
    );
    return parseAiCandidates(content, "closest").slice(0, 40);
  } catch (error) {
    console.error("Fallback candidate pass failed:", error);
    return [];
  }
}
