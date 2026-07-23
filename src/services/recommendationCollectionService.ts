import { buildRecommendations } from "./recommendationEngine";
import { recommendationCollectionGroqModel } from "./groqModelConfig";
import {
  generatedRecommendationShelfService,
  type GeneratedRecommendationShelfService,
} from "./generatedRecommendationShelfService";
import { normalizeBookKey } from "./recommendationCacheService";
import type {
  RecommendationResult,
  RecommendationRequestType,
} from "../types/recommendations";

export type CollectionReaderContext = {
  libraryBookKeys?: string[];
  finishedBookKeys?: string[];
  currentlyReadingBookKeys?: string[];
  ratings?: Array<{
    title: string;
    author?: string;
    rating: number;
  }>;
  highestRatedBooks?: Array<{
    title: string;
    author?: string;
    rating?: number;
    genres?: string[];
    moods?: string[];
    tropes?: string[];
    tags?: string[];
    seriesName?: string;
  }>;
  readingSessions?: Array<{
    bookKey: string;
    lastReadAt?: string;
    pagesRead?: number;
    minutesRead?: number;
  }>;
  pagePreferences?: {
    preferredMinPages?: number;
    preferredMaxPages?: number;
  };
  favoriteGenres?: string[];
  favoriteSubgenres?: string[];
  favoriteTropes?: string[];
  favoriteMoods?: string[];
  favoriteThemes?: string[];
  favoriteAuthors?: string[];
  favoriteTags?: string[];
  recentBookKeys?: string[];
  dismissedBookKeys?: string[];
  alreadyRecommendedBookKeys?: string[];
  readingGoals?: Array<{
    title: string;
    type: string;
    cadence?: string;
    progressPercent?: number;
    targetGenre?: string;
    targetSubgenre?: string;
    targetAuthorName?: string;
    linkedGenres?: string[];
    linkedTags?: string[];
  }>;
  readingStats?: {
    currentReadingStreak?: number;
    bestReadingStreak?: number;
    totalBooksFinished?: number;
    totalPagesRead?: number;
    totalMinutesRead?: number;
    booksFinishedThisYear?: number;
    pagesReadThisYear?: number;
    averagePagesPerSession?: number;
    averageMinutesPerSession?: number;
    favoriteGenre?: string;
    favoriteAuthor?: string;
  };
  challengeParticipation?: {
    activeCount?: number;
    completedCount?: number;
    recentChallengeTitles?: string[];
    preferredChallengeThemes?: string[];
  };
};

export type RecommendationCollection = {
  id: string;
  title: string;
  description: string;
  reason: string;
  bookCount: number;
  books: RecommendationResult[];
  previewCoverUrls: string[];
};

export type RecommendationCollectionsResponse = {
  collections: RecommendationCollection[];
};

export type BuildRecommendationCollectionsInput = {
  userId?: string;
  collectionId?: string;
  readerContext?: CollectionReaderContext;
  excludeBookKeys?: string[];
  desiredCollections?: number;
  booksPerCollection?: number;
};

type CollectionBlueprint = {
  id: string;
  title: string;
  description: string;
  reason: string;
  query: string;
  requestTypeHint: RecommendationRequestType;
};

type BuildRecommendationsFn = typeof buildRecommendations;

type RecommendationCollectionBuilderDependencies = {
  buildRecommendations: BuildRecommendationsFn;
  shelfService: GeneratedRecommendationShelfService;
};

const DEFAULT_COLLECTION_COUNT = 5;
const DEFAULT_BOOKS_PER_COLLECTION = 15;
const MAX_COLLECTION_COUNT = 6;
const MAX_BOOKS_PER_COLLECTION = 15;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(values: unknown, limit = 12): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const value of values) {
    const text = cleanText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(text);
    if (cleaned.length >= limit) break;
  }

  return cleaned;
}

function clampCount(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), max));
}

function firstSignal(values: string[]): string {
  return values[0] ?? "";
}

function joinSignals(values: string[], fallback: string): string {
  const cleaned = cleanStringArray(values, 8);
  return cleaned.length > 0 ? cleaned.join(", ") : fallback;
}

function favoriteBookSignal(context: CollectionReaderContext): string {
  const favorite = context.highestRatedBooks?.find((book) => cleanText(book.title));
  if (!favorite) return "";

  const author = cleanText(favorite.author);
  return author ? `${favorite.title} by ${author}` : favorite.title;
}

function tasteSignals(context: CollectionReaderContext): string[] {
  const signals = [
    ...cleanStringArray(context.favoriteGenres, 4),
    ...cleanStringArray(context.favoriteMoods, 3),
    ...cleanStringArray(context.favoriteTropes, 3),
    ...cleanStringArray(context.favoriteTags, 3),
    ...cleanStringArray(context.favoriteAuthors, 3),
  ];

  const statsGenre = cleanText(context.readingStats?.favoriteGenre);
  const statsAuthor = cleanText(context.readingStats?.favoriteAuthor);
  if (statsGenre) signals.push(statsGenre);
  if (statsAuthor) signals.push(statsAuthor);

  return cleanStringArray(signals, 10);
}

function goalSignals(context: CollectionReaderContext): string[] {
  const goals = context.readingGoals ?? [];
  const values: string[] = [];

  for (const goal of goals) {
    const targetGenre = cleanText(goal.targetGenre);
    const targetSubgenre = cleanText(goal.targetSubgenre);
    const targetAuthor = cleanText(goal.targetAuthorName);

    if (targetGenre) values.push(targetGenre);
    if (targetSubgenre) values.push(targetSubgenre);
    if (targetAuthor) values.push(targetAuthor);
    values.push(...cleanStringArray(goal.linkedGenres, 4));
    values.push(...cleanStringArray(goal.linkedTags, 4));
  }

  return cleanStringArray(values, 8);
}

function personalityTitle(context: CollectionReaderContext): string {
  const genre = firstSignal(cleanStringArray(context.favoriteGenres, 1));
  const mood = firstSignal(cleanStringArray(context.favoriteMoods, 1));
  const maxPages = context.pagePreferences?.preferredMaxPages;
  const booksFinished = context.readingStats?.booksFinishedThisYear ?? 0;

  if (maxPages !== undefined && maxPages <= 280) return "Quick Reads You'll Love";
  if (mood && genre) return `Your ${mood} ${genre} Picks`;
  if (genre && booksFinished >= 6) return `For Your ${genre} Era`;
  if (mood) return `${mood} Books For You`;
  return "Based On Your Reading Personality";
}

function collectionBlueprints(
  context: CollectionReaderContext,
  desiredCollections: number,
): CollectionBlueprint[] {
  const signals = tasteSignals(context);
  const goals = goalSignals(context);
  const favoriteGenres = cleanStringArray(context.favoriteGenres, 4);
  const favoriteMoods = cleanStringArray(context.favoriteMoods, 4);
  const favoriteTropes = cleanStringArray(context.favoriteTropes, 4);
  const favoriteAuthors = cleanStringArray(context.favoriteAuthors, 4);
  const favoriteTags = cleanStringArray(context.favoriteTags, 4);
  const challengeThemes = cleanStringArray(
    context.challengeParticipation?.preferredChallengeThemes,
    4,
  );
  const topGenre = firstSignal(favoriteGenres);
  const favoriteBook = favoriteBookSignal(context);
  const signalText = joinSignals(
    [...signals, ...goals, ...challengeThemes],
    "the reader's finished books, ratings, goals, and reading habits",
  );
  const collectionIdeas: CollectionBlueprint[] = [];

  if (favoriteBook) {
    collectionIdeas.push({
      id: "because-you-loved",
      title: `Because You Loved ${favoriteBook.split(" by ")[0]}`,
      description: "Books with a similar blend of story texture, mood, and reader appeal.",
      reason: `Anchored on ${favoriteBook} and weighted by the reader's highest-rated books.`,
      query: `Books like ${favoriteBook}. Prioritize these reader taste signals: ${signalText}.`,
      requestTypeHint: "specific_book",
    });
  }

  collectionIdeas.push({
    id: "similar-to-your-favorites",
    title: "Similar To Your Favorites",
    description: "Books matching the themes, genres, and patterns of books already loved.",
    reason: "Built from favorite books, ratings, authors, genres, moods, tropes, and tags.",
    query: `Recommend books similar to this reader's favorites. Favorite genres: ${joinSignals(favoriteGenres, "unknown")}. Favorite moods: ${joinSignals(favoriteMoods, "unknown")}. Favorite tropes: ${joinSignals(favoriteTropes, "unknown")}. Favorite tags: ${joinSignals(favoriteTags, "unknown")}. Favorite authors: ${joinSignals(favoriteAuthors, "unknown")}.`,
    requestTypeHint: topGenre ? "genre" : "natural_language",
  });

  if (topGenre) {
    collectionIdeas.push({
      id: "new-releases-for-you",
      title: `New ${topGenre} Releases`,
      description: "Recent books filtered through the parts of your library you rate highest.",
      reason: `Uses ${topGenre} as the main lane, then narrows by the reader's moods, tropes, and authors.`,
      query: `Recent ${topGenre} releases for a reader who likes ${signalText}.`,
      requestTypeHint: "genre",
    });
  }

  collectionIdeas.push({
    id: "hidden-gems",
    title: "Hidden Gems You Might Like",
    description: "Less obvious picks with strong metadata overlap and solid reader fit.",
    reason: "Prioritizes matching signals over mainstream popularity.",
    query: `Hidden gem books for a reader who likes ${signalText}. Avoid only obvious mainstream picks.`,
    requestTypeHint: "natural_language",
  });

  collectionIdeas.push({
    id: "continue-your-journey",
    title: "Continue Your Reading Journey",
    description: "Books that match your current pace, goals, and ongoing reading habits.",
    reason: "Uses current reads, recent sessions, page preferences, reading goals, and progress patterns.",
    query: `Books to continue this reader's current reading journey. Current reading keys: ${joinSignals(context.currentlyReadingBookKeys ?? [], "none")}. Goals and taste signals: ${signalText}.`,
    requestTypeHint: "natural_language",
  });

  collectionIdeas.push({
    id: "reading-personality",
    title: personalityTitle(context),
    description: "A shelf shaped by your reading speed, stats, favorite labels, and long-term habits.",
    reason: "Uses reading statistics and durable preference signals rather than a single search.",
    query: `Personalized books based on this reader's reading personality: ${signalText}. Stats: ${JSON.stringify(context.readingStats ?? {})}.`,
    requestTypeHint: "natural_language",
  });

  if (favoriteAuthors.length > 0) {
    collectionIdeas.push({
      id: "similar-authors",
      title: "Similar Authors",
      description: "Authors with a compatible audience, tone, and story promise.",
      reason: `Starts from ${favoriteAuthors.join(", ")} and expands to adjacent authors.`,
      query: `Authors and books similar to ${favoriteAuthors.join(", ")} for a reader who likes ${signalText}.`,
      requestTypeHint: "author",
    });
  }

  return collectionIdeas.slice(0, desiredCollections);
}

function collectionExclusions(
  baseExcluded: string[],
  returnedBookKeys: Set<string>,
): string[] {
  return [...baseExcluded, ...returnedBookKeys];
}

async function generateShelfResponse(input: {
  blueprint: CollectionBlueprint;
  context: CollectionReaderContext;
  groqModel: string;
  baseExcluded: string[];
  returnedBookKeys: Set<string>;
  booksPerCollection: number;
  buildRecommendationsFn: BuildRecommendationsFn;
  startedAt: number;
}): Promise<RecommendationCollectionsResponse> {
  let response: Awaited<ReturnType<typeof buildRecommendations>>;
  try {
    response = await input.buildRecommendationsFn({
      query: input.blueprint.query,
      surface: "shelf",
      desiredCount: input.booksPerCollection,
      minVerifiedResults: Math.min(8, input.booksPerCollection),
      groqModel: input.groqModel,
      requestTypeHint: input.blueprint.requestTypeHint,
      readerContext: input.context,
      excludeBookKeys: collectionExclusions(
        input.baseExcluded,
        input.returnedBookKeys,
      ),
    });
  } catch (error) {
    console.error("[recommendations:collections] shelf failed", {
      collectionId: input.blueprint.id,
      title: input.blueprint.title,
      requestTypeHint: input.blueprint.requestTypeHint,
      booksPerCollection: input.booksPerCollection,
      durationMs: Date.now() - input.startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const books = response.recs.filter((book) => {
    const key = normalizeBookKey(book.title, book.author);
    if (input.returnedBookKeys.has(key)) return false;
    input.returnedBookKeys.add(key);
    return true;
  });

  if (books.length === 0) {
    console.warn("[recommendations:collections] shelf empty", {
      collectionId: input.blueprint.id,
      title: input.blueprint.title,
      engineReturnedCount: response.recs.length,
      verifiedCandidateCount: response.meta.verifiedCandidateCount,
      candidateGroups: response.meta.candidateGroups,
      durationMs: Date.now() - input.startedAt,
    });
    return {
      collections: [],
    };
  }

  console.log("[recommendations:collections] shelf complete", {
    collectionId: input.blueprint.id,
    title: input.blueprint.title,
    requestedBookCount: input.booksPerCollection,
    returnedBookCount: books.length,
    verifiedCandidateCount: response.meta.verifiedCandidateCount,
    candidateGroups: response.meta.candidateGroups,
    previewCoverCount: books
      .map((book) => book.coverUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 4).length,
    durationMs: Date.now() - input.startedAt,
  });

  return {
    collections: [
      {
        id: input.blueprint.id,
        title: input.blueprint.title,
        description: input.blueprint.description,
        reason: input.blueprint.reason,
        bookCount: input.booksPerCollection,
        books,
        previewCoverUrls: books
          .map((book) => book.coverUrl)
          .filter((url): url is string => Boolean(url))
          .slice(0, 4),
      },
    ],
  };
}

async function refreshSavedShelf(input: {
  userId: string;
  shelfKey: string;
  generationId: string;
  blueprint: CollectionBlueprint;
  context: CollectionReaderContext;
  groqModel: string;
  baseExcluded: string[];
  booksPerCollection: number;
  deps: RecommendationCollectionBuilderDependencies;
}): Promise<void> {
  const startedAt = Date.now();
  try {
    const response = await generateShelfResponse({
      blueprint: input.blueprint,
      context: input.context,
      groqModel: input.groqModel,
      baseExcluded: input.baseExcluded,
      returnedBookKeys: new Set<string>(),
      booksPerCollection: input.booksPerCollection,
      buildRecommendationsFn: input.deps.buildRecommendations,
      startedAt,
    });
    await input.deps.shelfService.completeRefresh({
      userId: input.userId,
      shelfKey: input.shelfKey,
      generationId: input.generationId,
      response,
    });
    console.log("[recommendations:collections] shelf refresh complete", {
      userId: input.userId,
      shelfKey: input.shelfKey,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    await input.deps.shelfService.failRefresh({
      userId: input.userId,
      shelfKey: input.shelfKey,
      generationId: input.generationId,
      error,
    });
    console.error("[recommendations:collections] shelf refresh failed", {
      userId: input.userId,
      shelfKey: input.shelfKey,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createRecommendationCollectionBuilder(
  deps: RecommendationCollectionBuilderDependencies = {
    buildRecommendations,
    shelfService: generatedRecommendationShelfService,
  },
) {
  return async function buildRecommendationCollections(
    input: BuildRecommendationCollectionsInput,
  ): Promise<RecommendationCollectionsResponse> {
  const startedAt = Date.now();
  const context: CollectionReaderContext = input.readerContext ?? {};
  const groqModel = recommendationCollectionGroqModel();
  const desiredCollections = clampCount(
    input.desiredCollections,
    DEFAULT_COLLECTION_COUNT,
    MAX_COLLECTION_COUNT,
  );
  const booksPerCollection = clampCount(
    input.booksPerCollection,
    DEFAULT_BOOKS_PER_COLLECTION,
    MAX_BOOKS_PER_COLLECTION,
  );
  const baseExcluded = cleanStringArray(
    [
      ...(input.excludeBookKeys ?? []),
      ...(context.libraryBookKeys ?? []),
      ...(context.dismissedBookKeys ?? []),
      ...(context.alreadyRecommendedBookKeys ?? []),
    ],
    500,
  );
  const returnedBookKeys = new Set<string>();
  const blueprints = collectionBlueprints(context, desiredCollections);

  if (!input.collectionId) {
    console.log("[recommendations:collections] metadata response", {
      collectionCount: blueprints.length,
      booksPerCollection,
      desiredCollections,
      hasReaderContext: Boolean(input.readerContext),
      excludedCount: baseExcluded.length,
      durationMs: Date.now() - startedAt,
    });
    return {
      collections: blueprints.map((blueprint) => ({
        id: blueprint.id,
        title: blueprint.title,
        description: blueprint.description,
        reason: blueprint.reason,
        bookCount: booksPerCollection,
        books: [],
        previewCoverUrls: [],
      })),
    };
  }

  const blueprint = blueprints.find((item) => item.id === input.collectionId);
  if (!blueprint) {
    console.warn("[recommendations:collections] unknown collection", {
      collectionId: input.collectionId,
      availableCollectionIds: blueprints.map((item) => item.id),
      durationMs: Date.now() - startedAt,
    });
    return {
      collections: [],
    };
  }

  console.log("[recommendations:collections] shelf start", {
    collectionId: blueprint.id,
    title: blueprint.title,
    requestTypeHint: blueprint.requestTypeHint,
    booksPerCollection,
    desiredCollections,
    hasReaderContext: Boolean(input.readerContext),
    excludedCount: baseExcluded.length,
  });

  if (input.userId) {
    const shelfKey = blueprint.id;
    const cached = await deps.shelfService.lookup(input.userId, shelfKey);

    if (cached.state === "fresh") {
      console.log("[recommendations:collections] shelf cache hit", {
        userId: input.userId,
        shelfKey,
        durationMs: Date.now() - startedAt,
      });
      return cached.response;
    }

    if (cached.state === "expired") {
      const refreshClaim = await deps.shelfService.claimRefresh({
        userId: input.userId,
        shelfKey,
        shelfTitle: blueprint.title,
      });
      if (refreshClaim) {
        void refreshSavedShelf({
          userId: input.userId,
          shelfKey,
          generationId: refreshClaim.generationId,
          blueprint,
          context,
          groqModel,
          baseExcluded,
          booksPerCollection,
          deps,
        });
      }
      console.log("[recommendations:collections] shelf stale cache served", {
        userId: input.userId,
        shelfKey,
        refreshStarted: Boolean(refreshClaim),
        durationMs: Date.now() - startedAt,
      });
      return cached.response;
    }

    if (cached.state === "generating") {
      const completed = await deps.shelfService.waitForCompletedShelf(
        input.userId,
        shelfKey,
      );
      if (completed) {
        console.log("[recommendations:collections] shelf waited for existing generation", {
          userId: input.userId,
          shelfKey,
          durationMs: Date.now() - startedAt,
        });
        return completed;
      }
    }

    const claim = await deps.shelfService.claimGeneration({
      userId: input.userId,
      shelfKey,
      shelfTitle: blueprint.title,
    });

    if (!claim) {
      const completed = await deps.shelfService.waitForCompletedShelf(
        input.userId,
        shelfKey,
      );
      if (completed) return completed;

      console.warn("[recommendations:collections] shelf generation already running", {
        userId: input.userId,
        shelfKey,
        durationMs: Date.now() - startedAt,
      });
      return { collections: [] };
    }

    try {
      const generated = await generateShelfResponse({
        blueprint,
        context,
        groqModel,
        baseExcluded,
        returnedBookKeys,
        booksPerCollection,
        buildRecommendationsFn: deps.buildRecommendations,
        startedAt,
      });
      await deps.shelfService.completeGeneration({
        userId: input.userId,
        shelfKey,
        generationId: claim.generationId,
        response: generated,
      });
      return generated;
    } catch (error) {
      await deps.shelfService.failGeneration({
        userId: input.userId,
        shelfKey,
        generationId: claim.generationId,
        error,
      });
      throw error;
    }
  }

  console.warn("[recommendations:collections] shelf cache skipped without userId", {
    collectionId: blueprint.id,
  });

  return generateShelfResponse({
    blueprint,
    context,
    groqModel,
    baseExcluded,
    returnedBookKeys,
    booksPerCollection,
    buildRecommendationsFn: deps.buildRecommendations,
    startedAt,
  });
  };
}

export const buildRecommendationCollections = createRecommendationCollectionBuilder();
