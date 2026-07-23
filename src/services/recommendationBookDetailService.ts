import { GeneratedRecommendationBookDetail } from "../models/GeneratedRecommendationBookDetail";
import { geminiGenerateJson } from "./geminiAIClient";
import { recommendationBookSummaryGeminiModel } from "./geminiModelConfig";
import { normalizeBookKey } from "./recommendationCacheService";

const GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";

const CATALOG_TIMEOUT_MS = 12_000;
const AI_MAX_TOKENS = 900;
const DETAIL_CACHE_VERSION = 3;

type RecommendationBookDetailRequest = {
  title: string;
  author: string;
  summary?: string;
  coverUrl?: string;
  pages?: number;
  releaseYear?: number;
  rating?: number;
  tags?: string[];
  genres?: string[];
  moods?: string[];
  tropes?: string[];
  themes?: string[];
  source?: string;
  strategyLabel?: string;
  rationale?: string;
};

type CatalogDetail = {
  title: string;
  author: string;
  subtitle?: string;
  publisher?: string;
  publicationYear?: number;
  isbn?: string;
  summary?: string;
  coverUrl?: string;
  pages?: number;
  rating?: number;
  categories: string[];
  subjects: string[];
  source: string;
};

type GoogleVolumeInfo = {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  description?: string;
  pageCount?: number;
  categories?: string[];
  averageRating?: number;
  industryIdentifiers?: Array<{
    type?: string;
    identifier?: string;
  }>;
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

type OpenLibrarySearchResponse = {
  docs?: Array<{
    title?: string;
    author_name?: string[];
    first_publish_year?: number;
    cover_i?: number;
    subject?: string[];
    isbn?: string[];
    publisher?: string[];
  }>;
};

type AIEnrichment = {
  summary?: string;
  genres?: string[];
  subgenres?: string[];
  moods?: string[];
  tags?: string[];
  tropes?: string[];
  themes?: string[];
  tone?: string;
  pacing?: string;
  audience?: string;
  romanceLevel?: string;
  darknessLevel?: string;
};

export type RecommendationBookDetailResponse = {
  title: string;
  author: string;
  subtitle?: string;
  publisher?: string;
  publicationYear?: number;
  isbn?: string;
  summary: string;
  coverUrl?: string;
  pages?: number;
  rating?: number;
  genres: string[];
  subgenres: string[];
  moods: string[];
  tags: string[];
  tropes: string[];
  themes: string[];
  tone?: string;
  pacing?: string;
  audience?: string;
  romanceLevel?: string;
  darknessLevel?: string;
  source: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueStrings(values: Array<unknown>, limit = 16): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    results.push(text);

    if (results.length >= limit) break;
  }

  return results;
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

function googleCoverUrl(volume: GoogleVolumeInfo): string | undefined {
  const rawUrl =
    cleanText(volume.imageLinks?.thumbnail) ||
    cleanText(volume.imageLinks?.smallThumbnail);
  return rawUrl ? rawUrl.replace("http://", "https://") : undefined;
}

function googleISBN(volume: GoogleVolumeInfo): string | undefined {
  const identifiers = Array.isArray(volume.industryIdentifiers)
    ? volume.industryIdentifiers
    : [];
  const isbn13 = identifiers.find(
    (identifier) => cleanText(identifier.type) === "ISBN_13",
  );
  const isbn10 = identifiers.find(
    (identifier) => cleanText(identifier.type) === "ISBN_10",
  );

  return cleanText(isbn13?.identifier) || cleanText(isbn10?.identifier) || undefined;
}

async function fetchJson<T>(url: URL, timeoutMs = CATALOG_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
  } finally {
    clearTimeout(timeout);
  }
}

async function searchGoogleBooks(
  input: RecommendationBookDetailRequest,
): Promise<CatalogDetail | null> {
  const url = new URL(GOOGLE_BOOKS_SEARCH_URL);
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || "";

  url.searchParams.set("q", `intitle:${input.title} inauthor:${input.author}`);
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

  const best = volumes
    .map((volume) => ({
      volume,
      score: scoreTitleAuthorMatch(
        input.title,
        input.author,
        cleanText(volume.title),
        Array.isArray(volume.authors) ? volume.authors[0] ?? "" : "",
      ),
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 10) return null;

  const releaseYear = extractYear(best.volume.publishedDate);
  const pages = firstNumber(best.volume.pageCount);
  const rating = firstNumber(best.volume.averageRating);
  const coverUrl = googleCoverUrl(best.volume);
  const isbn = googleISBN(best.volume);

  return {
    title: cleanText(best.volume.title),
    author: Array.isArray(best.volume.authors)
      ? best.volume.authors.slice(0, 3).join(", ")
      : input.author,
    categories: uniqueStrings(best.volume.categories ?? [], 12),
    subjects: [],
    source: "Google Books",
    ...(cleanText(best.volume.subtitle) ? { subtitle: cleanText(best.volume.subtitle) } : {}),
    ...(cleanText(best.volume.publisher) ? { publisher: cleanText(best.volume.publisher) } : {}),
    ...(releaseYear !== undefined ? { publicationYear: releaseYear } : {}),
    ...(isbn ? { isbn } : {}),
    ...(cleanText(best.volume.description)
      ? { summary: stripHtml(cleanText(best.volume.description)) }
      : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(rating !== undefined ? { rating } : {}),
  };
}

async function searchOpenLibrary(
  input: RecommendationBookDetailRequest,
): Promise<CatalogDetail | null> {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);

  url.searchParams.set("q", `${input.title} ${input.author}`);
  url.searchParams.set("language", "eng");
  url.searchParams.set("limit", "5");
  url.searchParams.set(
    "fields",
    "title,author_name,first_publish_year,cover_i,subject,isbn,publisher",
  );

  const data = await fetchJson<OpenLibrarySearchResponse>(url);
  const docs = Array.isArray(data.docs) ? data.docs : [];
  const best = docs
    .filter((doc) => cleanText(doc.title))
    .map((doc) => ({
      doc,
      score: scoreTitleAuthorMatch(
        input.title,
        input.author,
        cleanText(doc.title),
        Array.isArray(doc.author_name) ? doc.author_name[0] ?? "" : "",
      ),
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 10) return null;

  const coverId = firstNumber(best.doc.cover_i);
  const publicationYear = firstNumber(best.doc.first_publish_year);
  const isbn = Array.isArray(best.doc.isbn)
    ? best.doc.isbn.find((value) => cleanText(value).length === 13) ??
      best.doc.isbn[0]
    : undefined;
  const publisher = Array.isArray(best.doc.publisher)
    ? best.doc.publisher[0]
    : undefined;

  return {
    title: cleanText(best.doc.title),
    author: Array.isArray(best.doc.author_name)
      ? best.doc.author_name.slice(0, 3).join(", ")
      : input.author,
    categories: [],
    subjects: uniqueStrings(best.doc.subject ?? [], 16),
    source: "Open Library",
    ...(publicationYear !== undefined ? { publicationYear } : {}),
    ...(cleanText(isbn) ? { isbn: cleanText(isbn) } : {}),
    ...(cleanText(publisher) ? { publisher: cleanText(publisher) } : {}),
    ...(coverId ? { coverUrl: `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` } : {}),
  };
}

function mergeCatalogDetails(
  input: RecommendationBookDetailRequest,
  google: CatalogDetail | null,
  openLibrary: CatalogDetail | null,
): CatalogDetail {
  const publisher = google?.publisher ?? openLibrary?.publisher;
  const publicationYear =
    google?.publicationYear ?? openLibrary?.publicationYear ?? input.releaseYear;
  const isbn = google?.isbn ?? openLibrary?.isbn;
  const summary = google?.summary ?? input.summary;
  const coverUrl = google?.coverUrl ?? openLibrary?.coverUrl ?? input.coverUrl;
  const pages = google?.pages ?? input.pages;
  const rating = google?.rating ?? input.rating;
  const source =
    google && openLibrary
      ? "Open Library + Google Books"
      : google?.source || openLibrary?.source || cleanText(input.source) || "Recommendation";

  return {
    title: google?.title ?? openLibrary?.title ?? input.title,
    author: google?.author ?? openLibrary?.author ?? input.author,
    categories: uniqueStrings(
      [...(google?.categories ?? []), ...(input.genres ?? [])],
      12,
    ),
    subjects: uniqueStrings(
      [
        ...(openLibrary?.subjects ?? []),
        ...(input.tags ?? []),
        ...(input.tropes ?? []),
        ...(input.themes ?? []),
      ],
      18,
    ),
    source,
    ...(google?.subtitle ? { subtitle: google.subtitle } : {}),
    ...(publisher ? { publisher } : {}),
    ...(publicationYear !== undefined ? { publicationYear } : {}),
    ...(isbn ? { isbn } : {}),
    ...(summary ? { summary } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(rating !== undefined ? { rating } : {}),
  };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const content = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  if (!content) return null;

  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function parseAIEnrichment(raw: string): AIEnrichment {
  const parsed = parseJsonObject(raw);
  if (!parsed) return {};

  return {
    ...(cleanText(parsed.summary) ? { summary: cleanText(parsed.summary) } : {}),
    genres: uniqueStrings(Array.isArray(parsed.genres) ? parsed.genres : [], 8),
    subgenres: uniqueStrings(Array.isArray(parsed.subgenres) ? parsed.subgenres : [], 8),
    moods: uniqueStrings(Array.isArray(parsed.moods) ? parsed.moods : [], 8),
    tags: uniqueStrings(Array.isArray(parsed.tags) ? parsed.tags : [], 12),
    tropes: uniqueStrings(Array.isArray(parsed.tropes) ? parsed.tropes : [], 10),
    themes: uniqueStrings(Array.isArray(parsed.themes) ? parsed.themes : [], 10),
    ...(cleanText(parsed.tone) ? { tone: cleanText(parsed.tone) } : {}),
    ...(cleanText(parsed.pacing) ? { pacing: cleanText(parsed.pacing) } : {}),
    ...(cleanText(parsed.audience) ? { audience: cleanText(parsed.audience) } : {}),
    ...(cleanText(parsed.romanceLevel)
      ? { romanceLevel: cleanText(parsed.romanceLevel) }
      : {}),
    ...(cleanText(parsed.darknessLevel)
      ? { darknessLevel: cleanText(parsed.darknessLevel) }
      : {}),
  };
}

async function generateAIEnrichment(
  input: RecommendationBookDetailRequest,
  catalog: CatalogDetail,
): Promise<AIEnrichment> {
  const systemPrompt = [
    "You are Lumey's book discovery copywriter for recommended shelf book detail pages.",
    "Your job is to make a reader think, 'oooo I want to read that,' while staying truthful to the supplied metadata.",
    "Return valid JSON only.",
    "Do not invent publication facts, ISBNs, publishers, awards, or endings.",
    "Do not write generic book-report prose.",
    "Do not reuse the shelf summary or catalog description verbatim.",
  ].join(" ");
  const userPrompt = [
    "Build a rich book detail payload for a recommended book in Loomey.",
    "Use the catalog metadata as the source of truth for factual metadata.",
    "Write the summary yourself in two polished short paragraphs.",
    "Paragraph 1 should hook the reader with the premise, emotional promise, and what kind of story they are stepping into.",
    "Paragraph 2 should explain the tone, genre texture, pacing or atmosphere, and why this book fits the recommendation shelf.",
    "Make the copy vivid, specific, sensory, and irresistible without sounding like marketing spam.",
    "Avoid spoilers, fake facts, fake awards, fake comparisons, and vague phrases like 'a must-read' unless the supplied data supports them.",
    "Return strict JSON only. The summary field is required.",
    "",
    "Recommendation context:",
    JSON.stringify(
      {
        title: input.title,
        author: input.author,
        shelfReason: input.rationale,
        strategyLabel: input.strategyLabel,
        summary: input.summary,
        genres: input.genres ?? [],
        moods: input.moods ?? [],
        tropes: input.tropes ?? [],
        themes: input.themes ?? [],
        tags: input.tags ?? [],
      },
      null,
      2,
    ),
    "",
    "Catalog metadata:",
    JSON.stringify(catalog, null, 2),
    "",
    "Return this exact shape:",
    JSON.stringify(
      {
        summary: "two concise polished paragraphs",
        genres: ["genre"],
        subgenres: ["subgenre"],
        moods: ["mood"],
        tags: ["tag"],
        tropes: ["trope"],
        themes: ["theme"],
        tone: "tone",
        pacing: "pacing",
        audience: "audience",
        romanceLevel: "none/low/medium/high",
        darknessLevel: "light/medium/dark",
      },
      null,
      2,
    ),
  ].join("\n");
  const model = recommendationBookSummaryGeminiModel();

  try {
    console.log("[recommendation-book-detail] gemini request", {
      title: input.title,
      author: input.author,
      model,
      promptChars: userPrompt.length,
    });

    const raw = await geminiGenerateJson(systemPrompt, userPrompt, {
      stage: "recommendation-book-detail",
      temperature: 0.35,
      maxOutputTokens: AI_MAX_TOKENS,
      model,
    });
    const parsed = parseAIEnrichment(raw);

    if (!cleanText(parsed.summary)) {
      throw new Error("Gemini book detail stage returned no usable summary");
    }

    console.log("[recommendation-book-detail] gemini success", {
      title: input.title,
      author: input.author,
      outputLength: raw.length,
      hasSummary: true,
      genres: parsed.genres?.length ?? 0,
      tags: parsed.tags?.length ?? 0,
    });

    return parsed;
  } catch (error) {
    console.error("[recommendation-book-detail] gemini failed", {
      title: input.title,
      author: input.author,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function buildResponse(
  input: RecommendationBookDetailRequest,
  catalog: CatalogDetail,
  ai: AIEnrichment,
): RecommendationBookDetailResponse {
  const summary = cleanText(ai.summary);
  if (!summary) {
    throw new Error("Gemini book detail stage did not return a summary");
  }

  const genres = uniqueStrings(
    [...(ai.genres ?? []), ...(input.genres ?? []), ...catalog.categories],
    10,
  );
  const tags = uniqueStrings(
    [...(ai.tags ?? []), ...catalog.subjects, ...(input.tags ?? [])],
    18,
  );

  return {
    title: catalog.title,
    author: catalog.author,
    summary,
    genres,
    subgenres: uniqueStrings(ai.subgenres ?? [], 8),
    moods: uniqueStrings([...(ai.moods ?? []), ...(input.moods ?? [])], 10),
    tags,
    tropes: uniqueStrings([...(ai.tropes ?? []), ...(input.tropes ?? [])], 10),
    themes: uniqueStrings([...(ai.themes ?? []), ...(input.themes ?? [])], 10),
    source: catalog.source,
    ...(catalog.subtitle ? { subtitle: catalog.subtitle } : {}),
    ...(catalog.publisher ? { publisher: catalog.publisher } : {}),
    ...(catalog.publicationYear !== undefined
      ? { publicationYear: catalog.publicationYear }
      : {}),
    ...(catalog.isbn ? { isbn: catalog.isbn } : {}),
    ...(catalog.coverUrl ? { coverUrl: catalog.coverUrl } : {}),
    ...(catalog.pages !== undefined ? { pages: catalog.pages } : {}),
    ...(catalog.rating !== undefined ? { rating: catalog.rating } : {}),
    ...(ai.tone ? { tone: ai.tone } : {}),
    ...(ai.pacing ? { pacing: ai.pacing } : {}),
    ...(ai.audience ? { audience: ai.audience } : {}),
    ...(ai.romanceLevel ? { romanceLevel: ai.romanceLevel } : {}),
    ...(ai.darknessLevel ? { darknessLevel: ai.darknessLevel } : {}),
  };
}

export async function buildRecommendationBookDetail(
  input: RecommendationBookDetailRequest,
): Promise<RecommendationBookDetailResponse> {
  const title = cleanText(input.title);
  const author = cleanText(input.author);

  if (!title || !author) {
    throw new Error("Book title and author are required");
  }

  const bookKey = normalizeBookKey(title, author);
  const cached = await GeneratedRecommendationBookDetail.findOne({ bookKey }).lean();
  if (cached?.response && cached.cacheVersion === DETAIL_CACHE_VERSION) {
    console.log("[recommendation-book-detail] cache hit", {
      bookKey,
      cacheVersion: DETAIL_CACHE_VERSION,
    });
    return cached.response;
  }

  console.log("[recommendation-book-detail] start", {
    title,
    author,
    hasSummary: Boolean(input.summary),
    cacheVersion: DETAIL_CACHE_VERSION,
    cacheRefreshReason: cached?.response ? "detail-cache-version-change" : "missing",
  });

  const request = { ...input, title, author };
  const [google, openLibrary] = await Promise.all([
    searchGoogleBooks(request).catch((error) => {
      console.error("[recommendation-book-detail] google lookup failed", {
        title,
        author,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }),
    searchOpenLibrary(request).catch((error) => {
      console.error("[recommendation-book-detail] open library lookup failed", {
        title,
        author,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }),
  ]);

  const catalog = mergeCatalogDetails(request, google, openLibrary);
  const ai = await generateAIEnrichment(request, catalog);
  const response = buildResponse(request, catalog, ai);

  await GeneratedRecommendationBookDetail.findOneAndUpdate(
    { bookKey },
    {
      $set: {
        bookKey,
        cacheVersion: DETAIL_CACHE_VERSION,
        title: response.title,
        author: response.author,
        response,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  console.log("[recommendation-book-detail] complete", {
    bookKey,
    title: response.title,
    author: response.author,
    cacheVersion: DETAIL_CACHE_VERSION,
    hasCover: Boolean(response.coverUrl),
    tagCount: response.tags.length,
  });

  return response;
}
