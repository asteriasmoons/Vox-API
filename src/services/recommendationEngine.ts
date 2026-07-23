import { recommendationAIService } from "./recommendationAIService";
import { bookCatalogService } from "./bookCatalogService";
import { bookDescriptionAIService } from "./bookDescriptionAIService";
import {
  makeRequestCacheKey,
  normalizeBookKey,
  recommendationCacheService,
} from "./recommendationCacheService";
import { recommendationScoringService } from "./recommendationScoringService";
import type {
  AiBookCandidate,
  CandidateGroup,
  RecommendationEngineResponse,
  RecommendationRequest,
  RecommendationRequestType,
  RecommendationSurface,
  SeedBook,
} from "../types/recommendations";

type BuildRecommendationsInput = {
  query: string;
  surface?: RecommendationSurface;
  desiredCount?: number;
  minVerifiedResults?: number;
  requestTypeHint?: RecommendationRequestType;
  seedBook?: SeedBook;
  excludeBookKeys?: string[];
  readerContext?: RecommendationRequest["readerContext"];
  groqModel?: string;
};

const DEFAULT_RESULT_COUNT = 30;
const MIN_VERIFIED_RESULTS = 12;
const MAX_RESULT_COUNT = 30;
const MAX_CANDIDATES_TO_VERIFY = 90;
const MAX_FALLBACK_CANDIDATES_TO_VERIFY = 50;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), MAX_RESULT_COUNT));
}

function normalizeRequest(input: BuildRecommendationsInput): RecommendationRequest {
  const query = cleanText(input.query).slice(0, 240);
  const desiredCount = clampCount(input.desiredCount, DEFAULT_RESULT_COUNT);
  const minVerifiedResults =
    input.minVerifiedResults === undefined
      ? MIN_VERIFIED_RESULTS
      : Math.max(1, Math.min(Math.floor(input.minVerifiedResults), desiredCount));

  return {
    query,
    surface: input.surface ?? "route",
    desiredCount,
    minVerifiedResults,
    ...(input.groqModel ? { groqModel: input.groqModel } : {}),
    ...(input.requestTypeHint ? { requestTypeHint: input.requestTypeHint } : {}),
    ...(input.seedBook ? { seedBook: input.seedBook } : {}),
    ...(input.readerContext ? { readerContext: input.readerContext } : {}),
    ...(input.excludeBookKeys ? { excludeBookKeys: input.excludeBookKeys } : {}),
  };
}

function flattenCandidateGroups(groups: CandidateGroup[]): AiBookCandidate[] {
  const seen = new Set<string>();
  const candidates: AiBookCandidate[] = [];

  for (const group of groups) {
    for (const candidate of group.candidates) {
      const key = normalizeBookKey(candidate.title, candidate.author ?? "");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

function mergeCandidateGroups(
  primaryGroups: CandidateGroup[],
  fallbackGroups: CandidateGroup[],
): CandidateGroup[] {
  if (fallbackGroups.length === 0) return primaryGroups;
  return [...primaryGroups, ...fallbackGroups];
}

function removeSeedAndExcludedCandidates(
  candidates: AiBookCandidate[],
  seedBook: SeedBook | null,
  request: RecommendationRequest,
): AiBookCandidate[] {
  const excludedKeys = new Set(request.excludeBookKeys ?? []);
  if (seedBook) {
    excludedKeys.add(normalizeBookKey(seedBook.title, seedBook.author));
  }

  return candidates.filter(
    (candidate) =>
      !excludedKeys.has(normalizeBookKey(candidate.title, candidate.author ?? "")),
    );
}

function countCandidates(groups: CandidateGroup[]): number {
  return groups.reduce((total, group) => total + group.candidates.length, 0);
}

export async function buildRecommendations(
  input: BuildRecommendationsInput,
): Promise<RecommendationEngineResponse> {
  const startedAt = Date.now();
  const request = normalizeRequest(input);

  if (!request.query && !request.seedBook) {
    console.log("[recommendations:engine] empty request", {
      surface: request.surface,
      desiredCount: request.desiredCount,
      minVerifiedResults: request.minVerifiedResults,
    });
    return {
      recs: [],
      meta: {
        requestType: request.requestTypeHint ?? "natural_language",
        normalizedQuery: "",
        seedResolved: false,
        candidateGroups: [],
        verifiedCandidateCount: 0,
      },
    };
  }

  const finalCacheKey = makeRequestCacheKey(request);
  const cached = recommendationCacheService.getFinalResponse(finalCacheKey);
  if (cached) {
    console.log("[recommendations:engine] cache hit", {
      surface: request.surface,
      desiredCount: request.desiredCount,
      returnedCount: cached.recs.length,
      durationMs: Date.now() - startedAt,
    });
    return cached;
  }

  console.log("[recommendations:engine] start", {
    surface: request.surface,
    desiredCount: request.desiredCount,
    minVerifiedResults: request.minVerifiedResults,
    requestTypeHint: request.requestTypeHint,
    queryLength: request.query.length,
    hasSeedBook: Boolean(request.seedBook),
    hasReaderContext: Boolean(request.readerContext),
    excludedCount: request.excludeBookKeys?.length ?? 0,
  });

  try {
    const intent = await recommendationAIService.analyzeRequest(request);
    console.log("[recommendations:engine] analyzed request", {
      surface: request.surface,
      requestType: intent.requestType,
      confidence: intent.confidence,
      normalizedQueryLength: intent.normalizedQuery.length,
    });

    const resolvedSeedBook =
      request.seedBook ??
      (await bookCatalogService.resolveSeedBook(
        intent.normalizedQuery || request.query,
        intent.requestType,
      ));
    const seedBook = resolvedSeedBook
      ? {
          ...resolvedSeedBook,
          description: await bookDescriptionAIService.ensureDescription({
            title: resolvedSeedBook.title,
            author: resolvedSeedBook.author,
            summary: resolvedSeedBook.description,
          }, request.groqModel ? { groqModel: request.groqModel } : undefined),
        }
      : null;
    console.log("[recommendations:engine] seed resolved", {
      surface: request.surface,
      requestType: intent.requestType,
      seedResolved: Boolean(seedBook),
      seedHasDescription: Boolean(seedBook?.description),
    });

    const profile = await recommendationAIService.analyzeSeedBook({
      request,
      intent,
      seedBook,
    });
    console.log("[recommendations:engine] profile ready", {
      surface: request.surface,
      requestType: profile.requestType,
      genrePresent: Boolean(profile.genre),
      subgenreCount: profile.subgenres.length,
      moodCount: profile.moods.length,
      tropeCount: profile.keyTropes.length,
      themeCount: profile.themes.length,
      comparableBookCount: profile.comparableBooks.length,
    });

    const primaryGroups = await recommendationAIService.generateCandidates({
      request,
      intent,
      profile,
      seedBook,
    });
    const primaryCandidates = removeSeedAndExcludedCandidates(
      flattenCandidateGroups(primaryGroups),
      seedBook,
      request,
    ).slice(0, MAX_CANDIDATES_TO_VERIFY);
    console.log("[recommendations:engine] primary candidates generated", {
      surface: request.surface,
      groupCount: primaryGroups.length,
      generatedCandidateCount: countCandidates(primaryGroups),
      candidateCountAfterExclusions: primaryCandidates.length,
      groups: primaryGroups.map((group) => ({
        strategy: group.strategy,
        count: group.candidates.length,
      })),
    });

    let verifiedCandidates =
      await bookCatalogService.verifyCandidates(primaryCandidates);
    console.log("[recommendations:engine] primary verification complete", {
      surface: request.surface,
      candidateCount: primaryCandidates.length,
      verifiedCandidateCount: verifiedCandidates.length,
      minVerifiedResults: request.minVerifiedResults,
    });
    let allGroups = primaryGroups;

    if (verifiedCandidates.length < request.minVerifiedResults) {
      const excludedTitles = [
        ...primaryCandidates.map((candidate) => candidate.title),
        ...verifiedCandidates.map((candidate) => candidate.title),
      ];
      console.warn("[recommendations:engine] fallback candidates needed", {
        surface: request.surface,
        verifiedCandidateCount: verifiedCandidates.length,
        minVerifiedResults: request.minVerifiedResults,
        excludedTitleCount: excludedTitles.length,
      });
      const fallbackGroups = await recommendationAIService.generateFallbackCandidates({
        request,
        intent,
        profile,
        seedBook,
        excludedTitles,
      });
      const fallbackCandidates = removeSeedAndExcludedCandidates(
        flattenCandidateGroups(fallbackGroups),
        seedBook,
        request,
      ).slice(0, MAX_FALLBACK_CANDIDATES_TO_VERIFY);
      console.log("[recommendations:engine] fallback candidates generated", {
        surface: request.surface,
        groupCount: fallbackGroups.length,
        generatedCandidateCount: countCandidates(fallbackGroups),
        candidateCountAfterExclusions: fallbackCandidates.length,
        groups: fallbackGroups.map((group) => ({
          strategy: group.strategy,
          count: group.candidates.length,
        })),
      });
      const fallbackVerified =
        await bookCatalogService.verifyCandidates(fallbackCandidates);
      console.log("[recommendations:engine] fallback verification complete", {
        surface: request.surface,
        candidateCount: fallbackCandidates.length,
        verifiedCandidateCount: fallbackVerified.length,
      });

      verifiedCandidates = [...verifiedCandidates, ...fallbackVerified];
      allGroups = mergeCandidateGroups(primaryGroups, fallbackGroups);
    }

    const seenVerified = new Set<string>();
    const dedupedVerified = verifiedCandidates.filter((candidate) => {
      const key = normalizeBookKey(candidate.title, candidate.author);
      if (seenVerified.has(key)) return false;
      seenVerified.add(key);
      return true;
    });
    console.log("[recommendations:engine] verification deduped", {
      surface: request.surface,
      verifiedCandidateCount: verifiedCandidates.length,
      dedupedVerifiedCount: dedupedVerified.length,
    });

    const describedVerified =
      await bookDescriptionAIService.ensureDescriptions(
        dedupedVerified,
        request.groqModel ? { groqModel: request.groqModel } : undefined,
      );
    console.log("[recommendations:engine] descriptions ready", {
      surface: request.surface,
      describedCandidateCount: describedVerified.length,
    });

    const recs = recommendationScoringService.scoreRecommendations({
      request,
      profile,
      seedBook,
      candidates: describedVerified,
    });

    const response: RecommendationEngineResponse = {
      recs,
      meta: {
        requestType: intent.requestType,
        normalizedQuery: intent.normalizedQuery,
        seedResolved: Boolean(seedBook),
        candidateGroups: allGroups.map((group) => ({
          strategy: group.strategy,
          count: group.candidates.length,
        })),
        verifiedCandidateCount: dedupedVerified.length,
      },
    };

    recommendationCacheService.setFinalResponse(finalCacheKey, response);
    console.log("[recommendations:engine] complete", {
      surface: request.surface,
      returnedCount: response.recs.length,
      verifiedCandidateCount: response.meta.verifiedCandidateCount,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    console.error("[recommendations:engine] failed", {
      surface: request.surface,
      desiredCount: request.desiredCount,
      minVerifiedResults: request.minVerifiedResults,
      requestTypeHint: request.requestTypeHint,
      queryLength: request.query.length,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
