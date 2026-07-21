import { normalizeBookKey } from "./recommendationCacheService";
import type {
  RecommendationProfile,
  RecommendationRequest,
  RecommendationResult,
  RecommendationStrategy,
  SeedBook,
  VerifiedRecommendationCandidate,
} from "../types/recommendations";

type ScoreInput = {
  request: RecommendationRequest;
  profile: RecommendationProfile;
  seedBook: SeedBook | null;
  candidates: VerifiedRecommendationCandidate[];
};

type IntermediateScore = VerifiedRecommendationCandidate & {
  matchScore: number;
  metadataScore: number;
  finalScore: number;
  seriesKey: string;
};

const STRATEGY_BASE_SCORE: Record<RecommendationStrategy, number> = {
  closest_match: 88,
  reader_safe: 78,
  hidden_gems: 74,
  recent_releases: 73,
  backlist: 72,
  adjacent_reads: 70,
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length > 2);
}

function overlapScore(source: string[], target: string[], weight: number): number {
  if (source.length === 0 || target.length === 0) return 0;

  const sourceNorm = source.map(normalizeText).filter(Boolean);
  const targetNorm = target.map(normalizeText).filter(Boolean);
  const matches = sourceNorm.filter((sourceItem) =>
    targetNorm.some(
      (targetItem) =>
        sourceItem.includes(targetItem) || targetItem.includes(sourceItem),
    ),
  );

  return Math.min(matches.length * weight, weight * 4);
}

function titleSimilarity(a: string, b: string): number {
  const aWords = words(a);
  const bWords = words(b);
  if (aWords.length === 0 || bWords.length === 0) return 0;

  const overlap = aWords.filter((word) => bWords.includes(word)).length;
  return (overlap / Math.max(aWords.length, bWords.length)) * 100;
}

function publicationPreferenceScore(
  strategy: RecommendationStrategy,
  releaseYear?: number,
): number {
  if (releaseYear === undefined) return 0;

  const currentYear = new Date().getFullYear();
  const age = currentYear - releaseYear;

  if (strategy === "recent_releases") {
    if (age <= 2) return 14;
    if (age <= 5) return 9;
    if (age <= 10) return 4;
    return 0;
  }

  if (strategy === "backlist") {
    if (age >= 8) return 12;
    if (age >= 4) return 6;
    return 1;
  }

  if (age <= 5) return 4;
  if (age >= 15) return 3;
  return 2;
}

function metadataScore(candidate: VerifiedRecommendationCandidate): number {
  let score = 25;

  if (candidate.summary && candidate.summary !== "No description available.") {
    score += 18;
  }
  if (candidate.coverUrl) score += 14;
  if (candidate.tags.length > 0) score += Math.min(candidate.tags.length * 2, 14);
  if (candidate.pages !== undefined) score += 7;
  if (candidate.releaseYear !== undefined) score += 7;
  if (candidate.rating !== undefined) score += Math.min(candidate.rating * 3, 15);
  if (candidate.source === "Open Library + Google Books") score += 12;
  else score += 6;

  return Math.min(score, 100);
}

function matchScore(
  candidate: VerifiedRecommendationCandidate,
  profile: RecommendationProfile,
  seedBook: SeedBook | null,
): number {
  let score = STRATEGY_BASE_SCORE[candidate.strategy];

  score += Math.min(candidate.catalogScore * 0.25, 20);
  score -= Math.min(candidate.candidateRank * 0.35, 14);
  score += publicationPreferenceScore(candidate.strategy, candidate.releaseYear);

  const candidateTags = candidate.tags;
  score += overlapScore(candidateTags, [profile.genre], 5);
  score += overlapScore(candidateTags, profile.subgenres, 6);
  score += overlapScore(candidateTags, profile.keyTropes, 5);
  score += overlapScore(candidateTags, profile.themes, 4);
  score += overlapScore(candidateTags, profile.moods, 4);

  if (
    profile.authors.some(
      (author) => normalizeText(author) === normalizeText(candidate.author),
    )
  ) {
    score += 10;
  }

  if (seedBook) {
    const sameBook =
      normalizeBookKey(seedBook.title, seedBook.author) ===
      normalizeBookKey(candidate.title, candidate.author);
    if (sameBook) score -= 200;

    if (normalizeText(seedBook.author) === normalizeText(candidate.author)) {
      score -= 14;
    }

    score -= titleSimilarity(seedBook.title, candidate.title) * 0.35;
  }

  return Math.max(0, Math.min(score, 100));
}

function seriesKey(candidate: VerifiedRecommendationCandidate): string {
  const normalizedTitle = normalizeText(candidate.title);
  const parenthetical = candidate.title.match(/\(([^)]+)\)/)?.[1];
  const colonPrefix = candidate.title.includes(":")
    ? candidate.title.split(":")[0]
    : "";
  const seriesHint = normalizeText(parenthetical || colonPrefix || normalizedTitle);

  return `${normalizeText(candidate.author)}|${seriesHint}`;
}

function toResult(score: IntermediateScore): RecommendationResult {
  return {
    title: score.title,
    author: score.author,
    summary: score.summary,
    matchScore: Math.round(score.matchScore),
    metadataScore: Math.round(score.metadataScore),
    finalScore: Math.round(score.finalScore),
    ...(score.coverUrl ? { coverUrl: score.coverUrl } : {}),
    ...(score.pages !== undefined ? { pages: score.pages } : {}),
    ...(score.releaseYear !== undefined ? { releaseYear: score.releaseYear } : {}),
    ...(score.rating !== undefined ? { rating: score.rating } : {}),
    ...(score.tags.length > 0 ? { tags: score.tags } : {}),
    ...(score.source ? { source: score.source } : {}),
    ...(score.strategy ? { strategy: score.strategy } : {}),
  };
}

function applyDiversity(
  scored: IntermediateScore[],
  request: RecommendationRequest,
): IntermediateScore[] {
  const selected: IntermediateScore[] = [];
  const deferred: IntermediateScore[] = [];
  const authorCounts = new Map<string, number>();
  const seriesCounts = new Map<string, number>();
  const strategyCounts = new Map<RecommendationStrategy, number>();
  const excludedKeys = new Set(request.excludeBookKeys ?? []);
  const strategySoftCap = Math.max(3, Math.ceil(request.desiredCount * 0.35));
  const authorLimit = request.surface === "home" ? 2 : 3;
  const seriesLimit = 2;

  for (const candidate of scored) {
    const bookKey = normalizeBookKey(candidate.title, candidate.author);
    if (excludedKeys.has(bookKey)) continue;

    const authorKey = normalizeText(candidate.author);
    const authorCount = authorCounts.get(authorKey) ?? 0;
    const seriesCount = seriesCounts.get(candidate.seriesKey) ?? 0;
    const strategyCount = strategyCounts.get(candidate.strategy) ?? 0;

    if (
      authorCount >= authorLimit ||
      seriesCount >= seriesLimit ||
      strategyCount >= strategySoftCap
    ) {
      deferred.push(candidate);
      continue;
    }

    selected.push(candidate);
    authorCounts.set(authorKey, authorCount + 1);
    seriesCounts.set(candidate.seriesKey, seriesCount + 1);
    strategyCounts.set(candidate.strategy, strategyCount + 1);

    if (selected.length >= request.desiredCount) {
      return selected;
    }
  }

  for (const candidate of deferred) {
    const bookKey = normalizeBookKey(candidate.title, candidate.author);
    if (excludedKeys.has(bookKey)) continue;

    if (
      !selected.some(
        (item) =>
          normalizeBookKey(item.title, item.author) ===
          normalizeBookKey(candidate.title, candidate.author),
      )
    ) {
      selected.push(candidate);
    }

    if (selected.length >= request.desiredCount) break;
  }

  return selected;
}

export const recommendationScoringService = {
  scoreRecommendations(input: ScoreInput): RecommendationResult[] {
    const scored = input.candidates
      .map((candidate) => {
        const candidateMatchScore = matchScore(
          candidate,
          input.profile,
          input.seedBook,
        );
        const candidateMetadataScore = metadataScore(candidate);
        const finalScore =
          candidateMatchScore * 0.68 + candidateMetadataScore * 0.32;

        return {
          ...candidate,
          matchScore: candidateMatchScore,
          metadataScore: candidateMetadataScore,
          finalScore,
          seriesKey: seriesKey(candidate),
        };
      })
      .filter((candidate) => candidate.finalScore > 0)
      .sort((a, b) => b.finalScore - a.finalScore);

    return applyDiversity(scored, input.request).map(toResult);
  },
};
