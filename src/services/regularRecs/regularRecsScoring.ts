//
//  regularRecsScoring.ts
//  Relevance scoring & result diversity for the REGULAR engine.
//

import {
  normalizeAuthor,
  normalizeKey,
  normalizeSeriesStem,
  overlapCount,
  uniqueStrings,
} from "./regularRecsUtils";
import {
  REGULAR_CANDIDATE_GROUP_BONUS,
  type RegularBookRec,
  type RegularRequestProfile,
} from "./regularRecsTypes";

const REGULAR_CURRENT_YEAR = new Date().getFullYear();

// The set of terms a good recommendation should touch: the profile's genres,
// subgenres, tropes, themes, moods, keywords, plus the seed book's subjects.
export function regularReferenceTerms(
  profile: RegularRequestProfile,
  seedSubjects: string[],
): string[] {
  return uniqueStrings([
    ...profile.primaryGenres,
    ...profile.subgenres,
    ...profile.tropes,
    ...profile.themes,
    ...profile.moods,
    ...profile.keywords,
    ...seedSubjects,
  ]);
}

// A book is "off-topic" only when it has REAL category metadata (so we can
// judge it) and none of it overlaps the reference terms. Books with sparse
// metadata get the benefit of the doubt.
export function regularIsOffTopic(
  rec: RegularBookRec,
  reference: string[],
): boolean {
  if (reference.length === 0) return false;
  const bookTerms = uniqueStrings([...rec.genres, ...rec.subjects]);
  if (bookTerms.length < 3) return false;
  return overlapCount(reference, bookTerms) === 0;
}

export function scoreRegularRelevance(
  rec: RegularBookRec,
  profile: RegularRequestProfile,
): number {
  const group = rec.candidateGroup ?? "adjacent";
  let score = REGULAR_CANDIDATE_GROUP_BONUS[group];

  const recTags = uniqueStrings([...rec.genres, ...rec.subjects, ...rec.matchTags]);
  score += overlapCount(profile.primaryGenres, recTags) * 12;
  score += overlapCount(profile.subgenres, recTags) * 10;
  score += overlapCount(profile.tropes, recTags) * 6;
  score += overlapCount(profile.themes, recTags) * 5;
  score += overlapCount(profile.moods, recTags) * 4;
  score += overlapCount(profile.keywords, recTags) * 3;

  // Publication year is a preference, never a filter.
  if (typeof rec.releaseYear === "number") {
    const age = REGULAR_CURRENT_YEAR - rec.releaseYear;
    if (group === "recent_release" && age <= 5) score += 8;
    if (group === "backlist" && age > 5) score += 4;
  }

  if (overlapCount(profile.excludeKeywords, recTags) > 0) score -= 25;

  score += rec.metadataScore * 0.5;
  score += rec.matchScore * 0.4;

  return Math.round(score);
}

export function applyRegularDiversity(
  recs: RegularBookRec[],
  limit: number,
): RegularBookRec[] {
  const authorCount = new Map<string, number>();
  const seriesCount = new Map<string, number>();
  const out: RegularBookRec[] = [];

  for (const rec of recs) {
    if (out.length >= limit) break;
    const authorKey = normalizeAuthor(rec.author);
    const seriesKey = `${authorKey}:${normalizeSeriesStem(rec.title)}`;
    const authorN = authorCount.get(authorKey) ?? 0;
    const seriesN = seriesCount.get(seriesKey) ?? 0;
    if (authorKey && authorN >= 2) continue;
    if (seriesN >= 2) continue;
    authorCount.set(authorKey, authorN + 1);
    seriesCount.set(seriesKey, seriesN + 1);
    out.push(rec);
  }

  // Backfill from the remainder if diversity trimming left us short.
  if (out.length < limit) {
    const chosen = new Set(out.map((r) => normalizeKey(r.title, r.author)));
    for (const rec of recs) {
      if (out.length >= limit) break;
      const key = normalizeKey(rec.title, rec.author);
      if (chosen.has(key)) continue;
      chosen.add(key);
      out.push(rec);
    }
  }

  return out;
}
