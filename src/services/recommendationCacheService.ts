import type {
  CatalogBookMetadata,
  RecommendationEngineResponse,
  RecommendationIntent,
  RecommendationProfile,
  RecommendationRequest,
  SeedBook,
} from "../types/recommendations";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 1000 * 60 * 30;
const SEED_TTL_MS = 1000 * 60 * 60 * 24;
const PROFILE_TTL_MS = 1000 * 60 * 60 * 12;
const CATALOG_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const FINAL_RESPONSE_TTL_MS = 1000 * 60 * 60 * 3;
const GENERATED_DESCRIPTION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const FINAL_RESPONSE_CACHE_VERSION = "generated-descriptions-v1";

const seedBooks = new Map<string, CacheEntry<SeedBook | null>>();
const requestIntents = new Map<string, CacheEntry<RecommendationIntent>>();
const requestProfiles = new Map<string, CacheEntry<RecommendationProfile>>();
const catalogLookups = new Map<string, CacheEntry<CatalogBookMetadata | null>>();
const finalResponses = new Map<string, CacheEntry<RecommendationEngineResponse>>();
const generatedDescriptions = new Map<string, CacheEntry<string>>();

function now(): number {
  return Date.now();
}

function get<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function set<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs = DEFAULT_TTL_MS,
): void {
  cache.set(key, {
    value,
    expiresAt: now() + ttlMs,
  });
}

function normalizeCacheText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s|:_-]/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeBookKey(title: string, author = ""): string {
  return `${normalizeCacheText(title)}|${normalizeCacheText(author)}`;
}

export function makeRequestCacheKey(request: RecommendationRequest): string {
  const exclusions = [...(request.excludeBookKeys ?? [])].sort().join(",");
  const readerContext = request.readerContext
      ? JSON.stringify({
          libraryBookKeys: request.readerContext.libraryBookKeys?.slice().sort(),
          finishedBookKeys: request.readerContext.finishedBookKeys?.slice().sort(),
          ratings: request.readerContext.ratings
            ?.slice()
            .sort((a, b) =>
              `${a.title}|${a.author ?? ""}`.localeCompare(
                `${b.title}|${b.author ?? ""}`,
              ),
            ),
          readingSessions: request.readerContext.readingSessions
            ?.slice()
            .sort((a, b) => a.bookKey.localeCompare(b.bookKey)),
          pagePreferences: request.readerContext.pagePreferences,
          favoriteGenres: request.readerContext.favoriteGenres?.slice().sort(),
          favoriteSubgenres: request.readerContext.favoriteSubgenres?.slice().sort(),
          favoriteTropes: request.readerContext.favoriteTropes?.slice().sort(),
        favoriteMoods: request.readerContext.favoriteMoods?.slice().sort(),
        favoriteThemes: request.readerContext.favoriteThemes?.slice().sort(),
        favoriteAuthors: request.readerContext.favoriteAuthors?.slice().sort(),
        favoriteTags: request.readerContext.favoriteTags?.slice().sort(),
        recentBookKeys: request.readerContext.recentBookKeys?.slice().sort(),
        dismissedBookKeys: request.readerContext.dismissedBookKeys?.slice().sort(),
        alreadyRecommendedBookKeys:
          request.readerContext.alreadyRecommendedBookKeys?.slice().sort(),
      })
    : "";

  return [
    FINAL_RESPONSE_CACHE_VERSION,
    request.surface,
    normalizeCacheText(request.query),
    request.desiredCount,
    request.minVerifiedResults,
    request.groqModel ?? "",
    request.requestTypeHint ?? "",
    exclusions,
    readerContext,
  ].join("::");
}

export const recommendationCacheService = {
  getSeedBook(key: string): SeedBook | null | undefined {
    const cacheKey = normalizeCacheText(key);
    const cached = get(seedBooks, cacheKey);
    return cached === null && seedBooks.has(cacheKey) ? null : cached ?? undefined;
  },

  setSeedBook(key: string, value: SeedBook | null): void {
    set(seedBooks, normalizeCacheText(key), value, SEED_TTL_MS);
  },

  getRequestIntent(key: string): RecommendationIntent | null {
    return get(requestIntents, normalizeCacheText(key));
  },

  setRequestIntent(key: string, value: RecommendationIntent): void {
    set(requestIntents, normalizeCacheText(key), value, PROFILE_TTL_MS);
  },

  getRequestProfile(key: string): RecommendationProfile | null {
    return get(requestProfiles, normalizeCacheText(key));
  },

  setRequestProfile(key: string, value: RecommendationProfile): void {
    set(requestProfiles, normalizeCacheText(key), value, PROFILE_TTL_MS);
  },

  getCatalogLookup(key: string): CatalogBookMetadata | null | undefined {
    const cacheKey = normalizeCacheText(key);
    const cached = get(catalogLookups, cacheKey);
    return cached === null && catalogLookups.has(cacheKey)
      ? null
      : cached ?? undefined;
  },

  setCatalogLookup(key: string, value: CatalogBookMetadata | null): void {
    set(catalogLookups, normalizeCacheText(key), value, CATALOG_TTL_MS);
  },

  getFinalResponse(key: string): RecommendationEngineResponse | null {
    return get(finalResponses, key);
  },

  setFinalResponse(key: string, value: RecommendationEngineResponse): void {
    set(finalResponses, key, value, FINAL_RESPONSE_TTL_MS);
  },

  getGeneratedDescription(title: string, author = ""): string | null {
    return get(generatedDescriptions, normalizeBookKey(title, author));
  },

  setGeneratedDescription(title: string, author: string, value: string): void {
    set(
      generatedDescriptions,
      normalizeBookKey(title, author),
      value,
      GENERATED_DESCRIPTION_TTL_MS,
    );
  },
};
