import { Router } from "express";
import { bookDescriptionAIService } from "../services/bookDescriptionAIService";

const router = Router();

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";

export type BookSearchResult = {
  title: string;
  author: string;
  summary: string;
  coverUrl?: string;
  pages?: number;
  releaseYear?: number;
  rating?: number;
  publisher?: string;
  isbn?: string;
  tags?: string[];
  source: string;
};

type OpenLibraryDoc = {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  publisher?: string[];
  subject?: string[];
  number_of_pages_median?: number;
};

type OpenLibraryResponse = {
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
  publisher?: string;
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

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractYear(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;

  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function normalizeKey(title: string, author: string): string {
  return `${title}|${author}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
}

function openLibraryCoverUrl(coverId?: number): string | undefined {
  return coverId
    ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
    : undefined;
}

function googleCoverUrl(volume?: GoogleVolumeInfo): string | undefined {
  const rawUrl =
    volume?.imageLinks?.thumbnail || volume?.imageLinks?.smallThumbnail;
  return rawUrl ? rawUrl.replace("http://", "https://") : undefined;
}

function googleISBN(volume?: GoogleVolumeInfo): string | undefined {
  const identifiers = volume?.industryIdentifiers ?? [];
  return (
    identifiers.find((item) => item.type === "ISBN_13")?.identifier ||
    identifiers.find((item) => item.type === "ISBN_10")?.identifier
  );
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
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
}

export async function searchOpenLibrary(query: string): Promise<BookSearchResult[]> {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);

  url.searchParams.set("q", query);
  url.searchParams.set("language", "eng");
  url.searchParams.set("limit", "12");
  url.searchParams.set(
    "fields",
    "title,author_name,first_publish_year,cover_i,isbn,publisher,subject,number_of_pages_median",
  );

  const data = await fetchJson<OpenLibraryResponse>(url);
  const docs = data.docs ?? [];

  return docs
    .filter((doc) => cleanText(doc.title))
    .map((doc) => {
      const result: BookSearchResult = {
        title: cleanText(doc.title),
        author: doc.author_name?.slice(0, 3).join(", ") ?? "",
        summary: "",
        tags: doc.subject?.slice(0, 10) ?? [],
        source: "Open Library",
      };

      const coverUrl = openLibraryCoverUrl(doc.cover_i);
      const pages = doc.number_of_pages_median;
      const releaseYear = doc.first_publish_year;
      const publisher = doc.publisher?.[0];
      const isbn = doc.isbn?.[0];

      if (coverUrl) result.coverUrl = coverUrl;
      if (pages !== undefined) result.pages = pages;
      if (releaseYear !== undefined) result.releaseYear = releaseYear;
      if (publisher) result.publisher = publisher;
      if (isbn) result.isbn = isbn;

      return result;
    });
}

export async function searchGoogleBooks(query: string): Promise<BookSearchResult[]> {
  const url = new URL(GOOGLE_BOOKS_SEARCH_URL);
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || "";

  url.searchParams.set("q", query);
  url.searchParams.set("printType", "books");
  url.searchParams.set("langRestrict", "en");
  url.searchParams.set("maxResults", "12");

  if (apiKey) {
    url.searchParams.set("key", apiKey);
  }

  const data = await fetchJson<GoogleBooksResponse>(url);
  const volumes = (data.items ?? [])
    .map((item) => item.volumeInfo)
    .filter((volume): volume is GoogleVolumeInfo => Boolean(volume?.title));

  return volumes.map((volume) => {
    const result: BookSearchResult = {
      title: cleanText(volume.title),
      author: volume.authors?.slice(0, 3).join(", ") ?? "",
      summary: cleanText(volume.description),
      tags: volume.categories ?? [],
      source: "Google Books",
    };

    const coverUrl = googleCoverUrl(volume);
    const releaseYear = extractYear(volume.publishedDate);
    const isbn = googleISBN(volume);

    if (coverUrl) result.coverUrl = coverUrl;
    if (volume.pageCount !== undefined) result.pages = volume.pageCount;
    if (releaseYear !== undefined) result.releaseYear = releaseYear;
    if (volume.averageRating !== undefined) result.rating = volume.averageRating;
    if (volume.publisher) result.publisher = volume.publisher;
    if (isbn) result.isbn = isbn;

    return result;
  });
}

function mergeResults(results: BookSearchResult[]): BookSearchResult[] {
  const merged = new Map<string, BookSearchResult>();

  for (const result of results) {
    const key = normalizeKey(result.title, result.author);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, result);
      continue;
    }

    const mergedTags = Array.from(
      new Set<string>([...(existing.tags ?? []), ...(result.tags ?? [])]),
    ).slice(0, 10);

    const mergedSource =
      existing.source === result.source
        ? existing.source
        : "Open Library + Google Books";

    const mergedBook: BookSearchResult = {
      title: existing.title || result.title,
      author: existing.author || result.author,
      summary: existing.summary || result.summary,
      source: mergedSource,
    };

    const coverUrl = existing.coverUrl || result.coverUrl;
    const pages = existing.pages || result.pages;
    const releaseYear = existing.releaseYear || result.releaseYear;
    const rating = existing.rating || result.rating;
    const publisher = existing.publisher || result.publisher;
    const isbn = existing.isbn || result.isbn;

    if (coverUrl) mergedBook.coverUrl = coverUrl;
    if (pages !== undefined) mergedBook.pages = pages;
    if (releaseYear !== undefined) mergedBook.releaseYear = releaseYear;
    if (rating !== undefined) mergedBook.rating = rating;
    if (publisher) mergedBook.publisher = publisher;
    if (isbn) mergedBook.isbn = isbn;
    if (mergedTags.length > 0) mergedBook.tags = mergedTags;

    merged.set(key, mergedBook);
  }

  return [...merged.values()];
}

router.post("/", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const safeQuery = query.slice(0, 160);

    const [openLibraryResults, googleBooksResults] = await Promise.all([
      searchOpenLibrary(safeQuery).catch((error) => {
        console.error("Open Library search failed:", error);
        return [] as BookSearchResult[];
      }),
      searchGoogleBooks(safeQuery).catch((error) => {
        console.error("Google Books search failed:", error);
        return [] as BookSearchResult[];
      }),
    ]);

    const mergedResults = mergeResults([
      ...googleBooksResults,
      ...openLibraryResults,
    ]).slice(0, 12);

    const resultsWithSummaries =
      await bookDescriptionAIService.ensureDescriptions(mergedResults);

    return res.json({ books: resultsWithSummaries });
  } catch (error) {
    console.error("Book search route error:", error);

    return res.status(500).json({
      error: "Failed to search books",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
