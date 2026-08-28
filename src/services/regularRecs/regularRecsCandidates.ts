//
//  regularRecsCandidates.ts
//  Multi-provider AI candidate generation + early deduplication.
//
//  The six candidate groups are spread across independent provider calls in
//  parallel so we still get the full multi-pass pool.
//

import { regularGroqChatJson } from "./regularRecsGroq";
import {
  regularMistralChatJson,
  regularSecondaryGroqChatJson,
} from "./regularRecsProviders";
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
  REGULAR_CANDIDATE_GROUP_BRIEF,
  REGULAR_CANDIDATE_GROUPS,
  type RegularAiCandidate,
  type RegularCandidateGroup,
  type RegularRequestProfile,
  type RegularSeedBook,
} from "./regularRecsTypes";

type ProviderFn = (
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; maxTokens: number },
) => Promise<string>;

// Which provider generates which candidate groups (parallel, independent budgets).
const PROVIDER_JOBS: Array<{
  label: string;
  run: ProviderFn;
  groups: RegularCandidateGroup[];
}> = [
  { label: "Groq", run: regularGroqChatJson, groups: ["closest", "reader_safe"] },
  { label: "Mistral", run: regularMistralChatJson, groups: ["hidden_gem", "backlist"] },
  { label: "Groq", run: regularSecondaryGroqChatJson, groups: ["recent_release", "adjacent"] },
];

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

// One provider call covering its assigned candidate groups (~8 books each).
async function generateGroupsWithProvider(
  run: ProviderFn,
  label: string,
  groups: RegularCandidateGroup[],
  requestText: string,
  seed: RegularSeedBook | null,
  profile: RegularRequestProfile,
): Promise<RegularAiCandidate[]> {
  const guide = groups
    .map((g) => `- "${g}": ${REGULAR_CANDIDATE_GROUP_BRIEF[g]}`)
    .join("\n");
  const perGroup = 10;

  const prompt = `You are Lumey's book similarity engine.

${regularSeedContextBlock(seed, requestText)}

Similarity profile:
${profileBlock(profile)}

Recommend ${groups.length * perGroup} real, published books (about ${perGroup} for EACH of these candidate groups):
${guide}

CRITICAL — NO HALLUCINATION:
- Only recommend REAL books you are certain exist, with their correct real title and author.
- NEVER invent or make up titles, authors, plots, genres, tropes, or reasons.
- The "reason" and "matchTags" MUST truthfully describe the ACTUAL book you named. NEVER copy the reader's request or the seed book's plot onto a different book. (E.g. do not call a psychological thriller a "portal fantasy" just because the request was.)
- If a book does not genuinely fit the request, LEAVE IT OUT. Returning fewer accurate books is far better than padding the list with wrong or invented ones.
- If you are not certain a book is real and a real match, do not include it.

Rules:
- Do NOT recommend the seed book or alternate editions of it.
- No duplicate titles.
- Keep the audience category appropriate (YA, New Adult, Adult, etc.).
- Prioritize exact subgenre and tonal matches over generic popularity.
- Do not fill the list with unrelated bestsellers.
- Tag each book's candidateGroup with one of: ${groups.join(", ")}.

Return STRICT JSON only:
{"books":[{"title":"","author":"","reason":"short internal relevance reason","matchTags":["tag1","tag2"],"candidateGroup":"${groups[0]}"}]}`;

  try {
    const content = await run(
      "You are a factual book recommender. You only name REAL published books and describe them truthfully. You never invent titles, authors, or details, and you never mislabel a book's genre or plot. Return strict JSON only — no markdown, prose, or summaries.",
      prompt,
      { temperature: 0.1, maxTokens: 8192 },
    );
    return parseAiCandidates(content, groups[0] ?? "closest");
  } catch (error) {
    console.error(`Candidate generation via ${label} failed:`, error);
    return [];
  }
}

// Fan out across all three providers in parallel, then merge.
export async function generateAllRegularCandidates(
  requestText: string,
  seed: RegularSeedBook | null,
  profile: RegularRequestProfile,
): Promise<RegularAiCandidate[]> {
  const results = await Promise.all(
    PROVIDER_JOBS.map((job) =>
      generateGroupsWithProvider(
        job.run,
        job.label,
        job.groups,
        requestText,
        seed,
        profile,
      ),
    ),
  );
  return results.flat();
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
