import {
  normalizeBookKey,
  recommendationCacheService,
} from "./recommendationCacheService";
import type {
  AiBookCandidate,
  CatalogBookMetadata,
  RecommendationRequestType,
  RecommendationSource,
  SeedBook,
  VerifiedRecommendationCandidate,
} from "../types/recommendations";

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";

const CATALOG_TIMEOUT_MS = 12_000;
const CATALOG_RETRIES = 1;
const CATALOG_CONCURRENCY = 5;
const MIN_CATALOG_SCORE = 10;

type OpenLibraryDoc = {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  subject?: string[];
};

type OpenLibrarySearchResponse = {
  docs?: OpenLibraryDoc[];
};

type GoogleVolumeInfo = {
  title?: string;
  authors?: string[];
  description?: string;
  publishedDate?: string;
  pageCount?: number;
  categories?: string[];
  averageRating?: number;
  imageLinks?: {
    thumbnail?: string;
    smallThumbnail?: string;
  };
};

type GoogleBooksResponse = {
  items?: Array<{
    volumeInfo?: GoogleVolumeInfo;
  }>;
};

type CatalogProviderResult = {
  title: string;
  author: string;
  summary?: string;
  coverUrl?: string;
  pages?: number;
  releaseYear?: number;
  rating?: number;
  tags: string[];
  source: Exclude<RecommendationSource, "Open Library + Google Books">;
  matchScore: number;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstNumber(value: unknown): number | undefined {
  const num = typeof value === "string" ? Number(value) : value;
  return typeof num === "number" && Number.isFinite(num) ? num : undefined;
}

function extractYear(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;

  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[], limit = 12): string[] {
  return values
    .map((value) => cleanText(value))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, limit);
}

function scoreTitleAuthorMatch(
  targetTitle: string,
  targetAuthor: string,
  candidateTitle: string,
  candidateAuthor: string,
): number {
  const normTargetTitle = normalizeText(targetTitle);
  const normTargetAuthor = normalizeText(targetAuthor);
  const normCandidateTitle = normalizeText(candidateTitle);
  const normCandidateAuthor = normalizeText(candidateAuthor);

  if (!normCandidateTitle) return 0;

  let score = 0;

  if (normTargetTitle && normCandidateTitle === normTargetTitle) {
    score += 55;
  } else if (
    normTargetTitle &&
    (normCandidateTitle.includes(normTargetTitle) ||
      normTargetTitle.includes(normCandidateTitle))
  ) {
    score += 35;
  } else if (normTargetTitle) {
    const targetWords = normTargetTitle
      .split(" ")
      .filter((word) => word.length > 2);
    const candidateWords = normCandidateTitle.split(" ");
    const overlap = targetWords.filter((word) =>
      candidateWords.some(
        (candidateWord) =>
          candidateWord.includes(word) || word.includes(candidateWord),
      ),
    ).length;
    score += overlap * 9;
  }

  if (normTargetAuthor && normCandidateAuthor) {
    if (normCandidateAuthor === normTargetAuthor) {
      score += 35;
    } else if (
      normCandidateAuthor.includes(normTargetAuthor) ||
      normTargetAuthor.includes(normCandidateAuthor)
    ) {
      score += 22;
    }
  } else if (!normTargetAuthor && normCandidateAuthor) {
    score += 5;
  }

  return Math.min(score, 100);
}

function openLibraryCoverUrl(coverId: unknown): string | undefined {
  const id = firstNumber(coverId);
  return id ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : undefined;
}

function googleCoverUrl(volume: GoogleVolumeInfo): string | undefined {
  const rawUrl =
    cleanText(volume.imageLinks?.thumbnail) ||
    cleanText(volume.imageLinks?.smallThumbnail);
  return rawUrl ? rawUrl.replace("http://", "https://") : undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: URL): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= CATALOG_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            body: json,
          }),
        );
      }

      return json as T;
    } catch (error) {
      lastError = error;
      if (attempt >= CATALOG_RETRIES) break;
      await sleep(250 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (
    typeof lastError === "object" &&
    lastError !== null &&
    "name" in lastError &&
    lastError.name === "AbortError"
  ) {
    throw new Error(`Catalog request timed out after ${CATALOG_TIMEOUT_MS / 1000}s`);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function pickBestOpenLibraryDoc(
  docs: OpenLibraryDoc[],
  candidate: Pick<AiBookCandidate, "title" | "author">,
): { doc: OpenLibraryDoc; score: number } | null {
  const scored = docs
    .filter((doc) => cleanText(doc.title))
    .map((doc) => {
      const title = cleanText(doc.title);
      const author = Array.isArray(doc.author_name) ? doc.author_name[0] ?? "" : "";
      const score = scoreTitleAuthorMatch(
        candidate.title,
        candidate.author ?? "",
        title,
        author,
      );
      return { doc, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0] ?? null;
}

function pickBestGoogleVolume(
  volumes: GoogleVolumeInfo[],
  candidate: Pick<AiBookCandidate, "title" | "author">,
): { volume: GoogleVolumeInfo; score: number } | null {
  const scored = volumes
    .filter((volume) => cleanText(volume.title))
    .map((volume) => {
      const title = cleanText(volume.title);
      const author = Array.isArray(volume.authors) ? volume.authors[0] ?? "" : "";
      const score = scoreTitleAuthorMatch(
        candidate.title,
        candidate.author ?? "",
        title,
        author,
      );
      return { volume, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0] ?? null;
}

async function searchOpenLibraryForSeed(query: string): Promise<SeedBook[]> {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);

  url.searchParams.set("q", query);
  url.searchParams.set("language", "eng");
  url.searchParams.set("limit", "8");
  url.searchParams.set("fields", "title,author_name,first_publish_year,subject");

  const data = await fetchJson<OpenLibrarySearchResponse>(url);
  const docs = Array.isArray(data.docs) ? data.docs : [];

  return docs
    .filter((doc) => cleanText(doc.title))
    .map((doc) => {
      const releaseYear = firstNumber(doc.first_publish_year);
      return {
        title: cleanText(doc.title),
        author: Array.isArray(doc.author_name)
          ? doc.author_name.slice(0, 3).join(", ")
          : "",
        subjects: Array.isArray(doc.subject) ? doc.subject.slice(0, 10) : [],
        description: "",
        source: "Open Library",
        ...(releaseYear !== undefined ? { releaseYear } : {}),
      };
    });
}

async function searchGoogleBooksForSeed(query: string): Promise<SeedBook[]> {
  const url = new URL(GOOGLE_BOOKS_SEARCH_URL);
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || "";

  url.searchParams.set("q", query);
  url.searchParams.set("printType", "books");
  url.searchParams.set("langRestrict", "en");
  url.searchParams.set("maxResults", "8");

  if (apiKey) {
    url.searchParams.set("key", apiKey);
  }

  const data = await fetchJson<GoogleBooksResponse>(url);
  const volumes = (data.items ?? [])
    .map((item) => item.volumeInfo)
    .filter((volume): volume is GoogleVolumeInfo => Boolean(volume?.title));

  return volumes.map((volume) => {
    const releaseYear = extractYear(volume.publishedDate);
    return {
      title: cleanText(volume.title),
      author: Array.isArray(volume.authors) ? volume.authors.slice(0, 3).join(", ") : "",
      subjects: Array.isArray(volume.categories) ? volume.categories.slice(0, 10) : [],
      description: cleanText(volume.description),
      source: "Google Books",
      ...(releaseYear !== undefined ? { releaseYear } : {}),
    };
  });
}

function mergeSeedResults(results: SeedBook[]): SeedBook[] {
  const merged = new Map<string, SeedBook>();

  for (const result of results) {
    const key = normalizeBookKey(result.title, result.author);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, result);
      continue;
    }

    const releaseYear = existing.releaseYear ?? result.releaseYear;
    const source =
      existing.source && result.source && existing.source !== result.source
        ? "Open Library + Google Books"
        : existing.source ?? result.source;

    merged.set(key, {
      title: existing.title || result.title,
      author: existing.author || result.author,
      subjects: uniqueStrings([...existing.subjects, ...result.subjects], 12),
      description: existing.description || result.description,
      ...(releaseYear !== undefined ? { releaseYear } : {}),
      ...(source ? { source } : {}),
    });
  }

  return [...merged.values()];
}

async function openLibraryLookup(
  candidate: AiBookCandidate,
): Promise<CatalogProviderResult | null> {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);
  const query = candidate.author
    ? `${candidate.title} ${candidate.author}`
    : candidate.title;

  url.searchParams.set("q", query);
  url.searchParams.set("language", "eng");
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "title,author_name,first_publish_year,cover_i,subject");

  const data = await fetchJson<OpenLibrarySearchResponse>(url);
  const docs = Array.isArray(data.docs) ? data.docs : [];
  const best = pickBestOpenLibraryDoc(docs, candidate);

  if (!best || best.score < MIN_CATALOG_SCORE) return null;

  const year = firstNumber(best.doc.first_publish_year);
  const coverUrl = openLibraryCoverUrl(best.doc.cover_i);

  return {
    title: cleanText(best.doc.title),
    author: Array.isArray(best.doc.author_name)
      ? best.doc.author_name.slice(0, 3).join(", ")
      : cleanText(candidate.author),
    tags: Array.isArray(best.doc.subject) ? best.doc.subject.slice(0, 10) : [],
    source: "Open Library",
    matchScore: best.score,
    ...(year !== undefined ? { releaseYear: year } : {}),
    ...(coverUrl ? { coverUrl } : {}),
  };
}

async function googleBooksLookup(
  candidate: AiBookCandidate,
): Promise<CatalogProviderResult | null> {
  const url = new URL(GOOGLE_BOOKS_SEARCH_URL);
  const query = candidate.author
    ? `intitle:${candidate.title} inauthor:${candidate.author}`
    : candidate.title;
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || "";

  url.searchParams.set("q", query);
  url.searchParams.set("printType", "books");
  url.searchParams.set("langRestrict", "en");
  url.searchParams.set("maxResults", "5");

  if (apiKey) {
    url.searchParams.set("key", apiKey);
  }

  const data = await fetchJson<GoogleBooksResponse>(url);
  const volumes = (data.items ?? [])
    .map((item) => item.volumeInfo)
    .filter((volume): volume is GoogleVolumeInfo => Boolean(volume?.title));
  const best = pickBestGoogleVolume(volumes, candidate);

  if (!best || best.score < MIN_CATALOG_SCORE) return null;

  const year = extractYear(best.volume.publishedDate);
  const coverUrl = googleCoverUrl(best.volume);
  const pages = firstNumber(best.volume.pageCount);
  const rating = firstNumber(best.volume.averageRating);

  return {
    title: cleanText(best.volume.title),
    author: Array.isArray(best.volume.authors)
      ? best.volume.authors.slice(0, 3).join(", ")
      : cleanText(candidate.author),
    summary: cleanText(best.volume.description),
    tags: Array.isArray(best.volume.categories) ? best.volume.categories : [],
    source: "Google Books",
    matchScore: best.score,
    ...(year !== undefined ? { releaseYear: year } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(rating !== undefined ? { rating } : {}),
  };
}

function mergeCatalogResults(
  candidate: AiBookCandidate,
  openLibrary: CatalogProviderResult | null,
  googleBooks: CatalogProviderResult | null,
): CatalogBookMetadata | null {
  if (!openLibrary && !googleBooks) return null;

  const title =
    cleanText(googleBooks?.title) ||
    cleanText(openLibrary?.title) ||
    cleanText(candidate.title);
  const author =
    cleanText(googleBooks?.author) ||
    cleanText(openLibrary?.author) ||
    cleanText(candidate.author);

  if (!title || !author) return null;

  const releaseYear = googleBooks?.releaseYear ?? openLibrary?.releaseYear;
  const coverUrl = googleBooks?.coverUrl ?? openLibrary?.coverUrl;
  const pages = googleBooks?.pages ?? openLibrary?.pages;
  const rating = googleBooks?.rating ?? openLibrary?.rating;
  const tags = uniqueStrings(
    [...(googleBooks?.tags ?? []), ...(openLibrary?.tags ?? [])],
    12,
  );
  const source: RecommendationSource =
    googleBooks && openLibrary ? "Open Library + Google Books" : googleBooks?.source ?? "Open Library";
  const catalogScore = Math.max(
    googleBooks?.matchScore ?? 0,
    openLibrary?.matchScore ?? 0,
  );

  return {
    title,
    author,
    summary:
      cleanText(googleBooks?.summary) ||
      cleanText(candidate.summary) ||
      "No description available.",
    tags,
    source,
    catalogScore,
    ...(coverUrl ? { coverUrl } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(releaseYear !== undefined ? { releaseYear } : {}),
    ...(rating !== undefined ? { rating } : {}),
  };
}

async function verifyAndEnrichCandidate(
  candidate: AiBookCandidate,
): Promise<CatalogBookMetadata | null> {
  const cacheKey = normalizeBookKey(candidate.title, candidate.author ?? "");
  const cached = recommendationCacheService.getCatalogLookup(cacheKey);
  if (cached !== undefined) return cached;

  const [openLibrary, googleBooks] = await Promise.all([
    openLibraryLookup(candidate).catch((error) => {
      console.error("Open Library lookup failed:", candidate, error);
      return null;
    }),
    googleBooksLookup(candidate).catch((error) => {
      console.error("Google Books lookup failed:", candidate, error);
      return null;
    }),
  ]);

  const metadata = mergeCatalogResults(candidate, openLibrary, googleBooks);
  recommendationCacheService.setCatalogLookup(cacheKey, metadata);

  return metadata;
}

async function mapWithBoundedConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => runWorker(),
  );

  await Promise.all(workers);
  return results;
}

export const bookCatalogService = {
  async resolveSeedBook(
    query: string,
    requestType: RecommendationRequestType,
  ): Promise<SeedBook | null> {
    if (!["specific_book", "natural_language"].includes(requestType)) {
      return null;
    }

    const cacheKey = `${requestType}:${query}`;
    const cached = recommendationCacheService.getSeedBook(cacheKey);
    if (cached !== undefined) return cached;

    const [openLibraryResults, googleBooksResults] = await Promise.all([
      searchOpenLibraryForSeed(query).catch((error) => {
        console.error("Open Library seed search failed:", error);
        return [] as SeedBook[];
      }),
      searchGoogleBooksForSeed(query).catch((error) => {
        console.error("Google Books seed search failed:", error);
        return [] as SeedBook[];
      }),
    ]);

    const candidates = mergeSeedResults([...googleBooksResults, ...openLibraryResults]);

    if (candidates.length === 0) {
      recommendationCacheService.setSeedBook(cacheKey, null);
      return null;
    }

    const scored = candidates
      .map((book) => ({
        book,
        score: scoreTitleAuthorMatch(query, "", book.title, book.author),
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (!best || best.score < 15) {
      recommendationCacheService.setSeedBook(cacheKey, null);
      return null;
    }

    recommendationCacheService.setSeedBook(cacheKey, best.book);
    return best.book;
  },

  async verifyCandidates(
    candidates: AiBookCandidate[],
  ): Promise<VerifiedRecommendationCandidate[]> {
    const enriched = await mapWithBoundedConcurrency(
      candidates,
      CATALOG_CONCURRENCY,
      async (candidate, index) => {
        const metadata = await verifyAndEnrichCandidate(candidate);
        if (!metadata) return null;

        return {
          ...metadata,
          strategy: candidate.strategy,
          candidateRank: index,
          ...(candidate.rationale ? { rationale: candidate.rationale } : {}),
        };
      },
    );

    return enriched.filter(
      (candidate): candidate is VerifiedRecommendationCandidate =>
        Boolean(candidate),
    );
  },
};
