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
import { buildRegularRequestProfile } from "./regularRecsRequestProfile";
import { applyRegularDiversity, scoreRegularRelevance } from "./regularRecsScoring";
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

  // Candidate groups are generated across Groq + Mistral + OpenRouter in
  // parallel (see regularRecsCandidates), so no single provider is a bottleneck.
  const candidates = dedupeRegularCandidates(
    await generateAllRegularCandidates(requestText, seed, profile),
    seed,
  ).filter((c) => !isExcluded(c, exclude));
  const generatedCount = candidates.length;

  const verified = verifiedDedupe(await verifyPool(candidates)).filter(
    (rec) => !isExcluded(rec, exclude),
  );

  for (const rec of verified) rec.finalScore = scoreRegularRelevance(rec, profile);
  verified.sort((a, b) => b.finalScore - a.finalScore);

  const limit = Math.max(
    1,
    Math.min(desiredCount, REGULAR_TARGET_FINAL_RECOMMENDATION_COUNT),
  );
  const finalRecs = applyRegularDiversity(verified, limit);

  return {
    recs: finalRecs,
    profile,
    seed,
    generatedCount,
    verifiedCount: verified.length,
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
