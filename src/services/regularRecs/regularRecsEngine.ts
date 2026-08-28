//
//  regularRecsEngine.ts
//  Orchestration for the REGULAR (books-like-this / reading-request) engine.
//  Shares NO code with the collections/shelves system.
//

import { REGULAR_TARGET_FINAL_RECOMMENDATION_COUNT } from "./regularRecsConfig";
import {
  resolveRegularSeedBook,
  verifyRegularCandidate,
} from "./regularRecsCatalog";
import {
  dedupeRegularCandidates,
  generateAllRegularCandidates,
} from "./regularRecsCandidates";
import {
  buildRegularRequestProfile,
  extractRegularCompTitles,
} from "./regularRecsRequestProfile";
import {
  applyRegularDiversity,
  regularIsOffTopic,
  regularReferenceTerms,
  scoreRegularRelevance,
} from "./regularRecsScoring";
import {
  mapWithConcurrency,
  normalizeAuthor,
  normalizeKey,
  normalizeTitle,
} from "./regularRecsUtils";
import {
  REGULAR_CATALOG_CONCURRENCY,
} from "./regularRecsConfig";
import type {
  RegularAiCandidate,
  RegularBookRec,
  RegularBuildResult,
} from "./regularRecsTypes";

function buildExclusionSet(excludeBookKeys: string[]): Set<string> {
  const set = new Set<string>();
  for (const key of excludeBookKeys) {
    const value = key.trim().toLowerCase();
    if (value) set.add(value);
  }
  return set;
}

function isExcluded(
  rec: { title: string; author: string },
  exclude: Set<string>,
): boolean {
  if (exclude.size === 0) return false;
  const t = normalizeTitle(rec.title);
  const a = normalizeAuthor(rec.author);
  const candidates = [
    `${t}|${a}`,
    `${t}-${a}`,
    `${rec.title.toLowerCase()}-${rec.author.toLowerCase()}`,
    t,
  ];
  return candidates.some((c) => exclude.has(c));
}

function verifiedDedupe(recs: RegularBookRec[]): RegularBookRec[] {
  const seen = new Set<string>();
  const out: RegularBookRec[] = [];
  for (const rec of recs) {
    const key = normalizeKey(rec.title, rec.author);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

async function verifyPool(candidates: RegularAiCandidate[]): Promise<RegularBookRec[]> {
  const verified = await mapWithConcurrency(
    candidates,
    REGULAR_CATALOG_CONCURRENCY,
    (candidate) => verifyRegularCandidate(candidate).catch(() => null),
  );
  return verified.filter((rec): rec is RegularBookRec => rec !== null);
}

export async function buildRegularRecommendations(
  requestText: string,
  desiredCount: number,
  minVerified: number,
  excludeBookKeys: string[],
): Promise<RegularBuildResult> {
  const exclude = buildExclusionSet(excludeBookKeys);

  const seed = await resolveRegularSeedBook(requestText);
  const profile = await buildRegularRequestProfile(requestText, seed);

  // High-confidence "comp" titles named in the seed's own jacket copy
  // (e.g. "perfect for fans of The Hazel Wood and Small Favors").
  const compCandidates: RegularAiCandidate[] = seed
    ? extractRegularCompTitles(seed.description).map((title) => ({
        title,
        author: "",
        reason: "Named as a comparable title in the book's description",
        matchTags: [],
        candidateGroup: "closest" as const,
      }))
    : [];

  // Candidate groups are generated across Groq + Mistral + secondary Groq in parallel
  // (see regularRecsCandidates); comps are merged in as extra strong candidates.
  const aiCandidates = await generateAllRegularCandidates(requestText, seed, profile);
  const candidates = dedupeRegularCandidates(
    [...compCandidates, ...aiCandidates],
    seed,
  ).filter((c) => !isExcluded(c, exclude));
  const generatedCount = candidates.length;

  const verified = verifiedDedupe(await verifyPool(candidates)).filter(
    (rec) => !isExcluded(rec, exclude),
  );

  // Drop books whose REAL metadata is clearly off-topic (genre drift), but keep
  // the full set if the gate would leave us too thin.
  const reference = regularReferenceTerms(profile, seed ? seed.subjects : []);
  const onTopic = verified.filter((rec) => !regularIsOffTopic(rec, reference));
  const pool = onTopic.length >= 12 ? onTopic : verified;

  for (const rec of pool) rec.finalScore = scoreRegularRelevance(rec, profile);
  pool.sort((a, b) => b.finalScore - a.finalScore);

  const limit = Math.max(
    1,
    Math.min(desiredCount, REGULAR_TARGET_FINAL_RECOMMENDATION_COUNT),
  );
  const finalRecs = applyRegularDiversity(pool, limit);

  return {
    recs: finalRecs,
    profile,
    seed,
    generatedCount,
    verifiedCount: pool.length,
  };
}

export function regularCandidateGroupCounts(
  recs: RegularBookRec[],
): Array<{ strategy: string; count: number }> {
  const counts = new Map<string, number>();
  for (const rec of recs) {
    const strategy = rec.strategy ?? rec.candidateGroup ?? "unknown";
    counts.set(strategy, (counts.get(strategy) ?? 0) + 1);
  }
  return [...counts.entries()].map(([strategy, count]) => ({ strategy, count }));
}

export function regularExcludeHash(keys: string[]): string {
  return [...keys]
    .map((k) => k.toLowerCase())
    .sort()
    .join(",")
    .slice(0, 200);
}
