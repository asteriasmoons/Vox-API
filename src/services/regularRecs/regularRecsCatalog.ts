//
//  regularRecsCatalog.ts
//  Google Books (primary) + Open Library (fallback) lookups, verification,
//  and seed resolution for the REGULAR engine.
//

import {
  REGULAR_CATALOG_TIMEOUT_MS,
  REGULAR_GOOGLE_BOOKS_SEARCH_URL,
  REGULAR_OPEN_LIBRARY_SEARCH_URL,
  REGULAR_TTL_CATALOG,
  REGULAR_TTL_SEED,
} from "./regularRecsConfig";
import { regularRecsCache } from "./regularRecsCache";
import {
  cleanText,
  extractYear,
  fetchJson,
  firstNumber,
  normalizeKey,
  scoreTitleAuthorMatch,
  sleep,
  suspiciousPenalty,
  toStringArray,
  uniqueStrings,
} from "./regularRecsUtils";
import {
  REGULAR_CANDIDATE_GROUP_LABEL,
  type RegularAiCandidate,
  type RegularBookRec,
  type RegularGoogleBooksResponse,
  type RegularGoogleVolumeInfo,
  type RegularOpenLibraryDoc,
  type RegularOpenLibrarySearchResponse,
  type RegularSeedBook,
} from "./regularRecsTypes";

// --- Raw searches (cached) --------------------------------------------------

export async function regularGoogleBooksSearch(
  query: string,
  maxResults: number,
): Promise<RegularGoogleVolumeInfo[]> {
  const cacheKey = `gb:${query.toLowerCase()}:${maxResults}`;
  const cached = regularRecsCache.get<RegularGoogleVolumeInfo[]>(cacheKey);
  if (cached) return cached;

  const url = new URL(REGULAR_GOOGLE_BOOKS_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("printType", "books");
  url.searchParams.set("langRestrict", "en");
  url.searchParams.set("maxResults", String(maxResults));
  const apiKey = cleanText(process.env.GOOGLE_BOOKS_API_KEY);
  if (apiKey) url.searchParams.set("key", apiKey);

  // Small jitter so parallel verifications don't burst Google Books at once
  // (it returns 503s under bursts).
  await sleep(Math.floor(Math.random() * 350));

  const data = await fetchJson<RegularGoogleBooksResponse>(
    url,
    REGULAR_CATALOG_TIMEOUT_MS,
    "Google Books",
    1, // fail fast; Open Library is the fallback
  );
  const volumes = (data?.items ?? [])
    .map((item) => item.volumeInfo)
    .filter((v): v is RegularGoogleVolumeInfo => Boolean(v?.title));
  regularRecsCache.set(cacheKey, volumes, REGULAR_TTL_CATALOG);
  return volumes;
}

export async function regularOpenLibrarySearch(
  query: string,
  maxResults: number,
): Promise<RegularOpenLibraryDoc[]> {
  const cacheKey = `ol:${query.toLowerCase()}:${maxResults}`;
  const cached = regularRecsCache.get<RegularOpenLibraryDoc[]>(cacheKey);
  if (cached) return cached;

  const url = new URL(REGULAR_OPEN_LIBRARY_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("language", "eng");
  url.searchParams.set("limit", String(maxResults));
  url.searchParams.set(
    "fields",
    "title,author_name,first_publish_year,cover_i,subject,isbn,language",
  );

  const data = await fetchJson<RegularOpenLibrarySearchResponse>(
    url,
    REGULAR_CATALOG_TIMEOUT_MS,
    "Open Library",
    2,
  );
  const docs = (data?.docs ?? []).filter((d) => cleanText(d.title));
  regularRecsCache.set(cacheKey, docs, REGULAR_TTL_CATALOG);
  return docs;
}

// --- Scoring helpers --------------------------------------------------------

function regularGoogleIdentifiers(v: RegularGoogleVolumeInfo): {
  isbn10?: string | undefined;
  isbn13?: string | undefined;
} {
  let isbn10: string | undefined;
  let isbn13: string | undefined;
  for (const id of v.industryIdentifiers ?? []) {
    if (id?.type === "ISBN_10" && id.identifier) isbn10 = cleanText(id.identifier);
    if (id?.type === "ISBN_13" && id.identifier) isbn13 = cleanText(id.identifier);
  }
  return { isbn10, isbn13 };
}

function scoreGoogleVolume(
  v: RegularGoogleVolumeInfo,
  candidate: RegularAiCandidate,
): number {
  const author = Array.isArray(v.authors) ? v.authors[0] ?? "" : "";
  let score = scoreTitleAuthorMatch(
    candidate.title,
    candidate.author,
    cleanText(v.title),
    author,
  );
  if ((v.language ?? "en") !== "en") score -= 20;
  if (v.printType && v.printType !== "BOOK") score -= 15;
  score -= suspiciousPenalty(`${cleanText(v.title)} ${cleanText(v.subtitle)}`);
  return score;
}

function scoreOpenLibraryDoc(
  d: RegularOpenLibraryDoc,
  candidate: RegularAiCandidate,
): number {
  const author = Array.isArray(d.author_name) ? d.author_name[0] ?? "" : "";
  let score = scoreTitleAuthorMatch(
    candidate.title,
    candidate.author,
    cleanText(d.title),
    author,
  );
  score -= suspiciousPenalty(cleanText(d.title));
  return score;
}

// --- Verification -----------------------------------------------------------

async function googleBooksVerify(
  candidate: RegularAiCandidate,
): Promise<RegularGoogleVolumeInfo | null> {
  const precise = candidate.author
    ? `intitle:${candidate.title} inauthor:${candidate.author}`
    : `intitle:${candidate.title}`;
  let volumes = await regularGoogleBooksSearch(precise, 5).catch(
    () => [] as RegularGoogleVolumeInfo[],
  );
  if (volumes.length === 0) {
    const broad = candidate.author
      ? `${candidate.title} ${candidate.author}`
      : candidate.title;
    volumes = await regularGoogleBooksSearch(broad, 5).catch(
      () => [] as RegularGoogleVolumeInfo[],
    );
  }
  if (volumes.length === 0) return null;

  const scored = volumes
    .map((v) => ({ v, score: scoreGoogleVolume(v, candidate) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 18) return null;
  return best.v;
}

async function openLibraryVerify(
  candidate: RegularAiCandidate,
): Promise<RegularOpenLibraryDoc | null> {
  const query = candidate.author
    ? `${candidate.title} ${candidate.author}`
    : candidate.title;
  const docs = await regularOpenLibrarySearch(query, 5).catch(
    () => [] as RegularOpenLibraryDoc[],
  );
  if (docs.length === 0) return null;
  const scored = docs
    .map((d) => ({ d, score: scoreOpenLibraryDoc(d, candidate) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 18) return null;
  return best.d;
}

function computeMetadataScore(rec: {
  author: string;
  summary: string;
  coverUrl?: string | undefined;
  pages?: number | undefined;
  rating?: number | undefined;
  isbn13?: string | undefined;
  isbn10?: string | undefined;
  genres: string[];
  releaseYear?: number | undefined;
}): number {
  let score = 0;
  if (rec.author) score += 12;
  if (rec.summary && rec.summary !== "No description available.") score += 22;
  if (rec.coverUrl) score += 20;
  if (typeof rec.pages === "number") score += 8;
  if (typeof rec.rating === "number") score += 10;
  if (rec.isbn13 || rec.isbn10) score += 10;
  if (rec.genres.length) score += 8;
  if (typeof rec.releaseYear === "number") score += 6;
  score -= suspiciousPenalty(rec.summary);
  return score;
}

// Partial/non-book editions we should DROP entirely (not the real readable book).
const REGULAR_JUNK_EDITION =
  /(free preview|\bsampler\b|\bexcerpt\b|first \d+ chapters|boxed set|box set|\bbooks?\s*\d+\s*[-–—]\s*\d+\b|\d+-book|complete (?:series|collection|novels))/i;

// Marketing suffixes to strip from an otherwise-real title for a clean display.
const REGULAR_EDITION_SUFFIX =
  /\s*[-–—:(]+\s*(?:a read with jenna pick|movie tie-?in edition|media tie-?in edition|tv tie-?in edition|movie tie-?in|deluxe edition|special edition|collector'?s edition|illustrated edition|anniversary edition)\b.*$/i;

export async function verifyRegularCandidate(
  candidate: RegularAiCandidate,
): Promise<RegularBookRec | null> {
  const [google, openLibrary] = await Promise.all([
    googleBooksVerify(candidate),
    openLibraryVerify(candidate),
  ]);

  if (!google && !openLibrary) return null;

  const googleAuthor = Array.isArray(google?.authors)
    ? google?.authors.slice(0, 3).join(", ")
    : "";
  const openLibraryAuthor = Array.isArray(openLibrary?.author_name)
    ? openLibrary?.author_name.slice(0, 3).join(", ")
    : "";

  let title =
    cleanText(google?.title) ||
    cleanText(openLibrary?.title) ||
    cleanText(candidate.title);
  const author =
    cleanText(googleAuthor) ||
    cleanText(openLibraryAuthor) ||
    cleanText(candidate.author);
  if (!title) return null;

  // Drop partial/non-book editions (previews, samplers, boxed sets).
  if (REGULAR_JUNK_EDITION.test(`${title} ${cleanText(google?.subtitle)}`)) {
    return null;
  }
  // Strip marketing/edition suffixes for a clean display title.
  title = title.replace(REGULAR_EDITION_SUFFIX, "").trim() || title;

  const ids = google ? regularGoogleIdentifiers(google) : {};
  const coverId = firstNumber(openLibrary?.cover_i);
  const googleCover =
    cleanText(google?.imageLinks?.thumbnail) ||
    cleanText(google?.imageLinks?.smallThumbnail);
  const coverUrl =
    (googleCover ? googleCover.replace("http://", "https://") : undefined) ??
    (coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined);

  const genres = uniqueStrings([
    ...toStringArray(google?.categories, 8),
    ...toStringArray(openLibrary?.subject, 8),
  ]).slice(0, 8);

  const releaseYear =
    extractYear(google?.publishedDate) ?? firstNumber(openLibrary?.first_publish_year);
  const summary = cleanText(google?.description) || "No description available.";

  if (suspiciousPenalty(`${title} ${summary}`) >= 60) return null;

  const matchScore =
    (google ? scoreGoogleVolume(google, candidate) : 0) +
    (openLibrary ? scoreOpenLibraryDoc(openLibrary, candidate) * 0.5 : 0) +
    (google && openLibrary ? 8 : 0);

  const base = {
    title,
    author,
    summary,
    coverUrl,
    pages: firstNumber(google?.pageCount),
    rating: firstNumber(google?.averageRating),
    isbn13: ids.isbn13,
    isbn10: ids.isbn10,
    genres,
    releaseYear,
  };

  const rec: RegularBookRec = {
    ...base,
    subtitle: cleanText(google?.subtitle) || undefined,
    publishedDate: cleanText(google?.publishedDate) || undefined,
    ratingsCount: firstNumber(google?.ratingsCount),
    subjects: uniqueStrings(toStringArray(openLibrary?.subject, 12)),
    tags: candidate.matchTags,
    matchTags: candidate.matchTags,
    recommendationReason: candidate.reason,
    candidateGroup: candidate.candidateGroup,
    strategy: candidate.candidateGroup,
    strategyLabel: REGULAR_CANDIDATE_GROUP_LABEL[candidate.candidateGroup],
    rationale: candidate.reason,
    source: google ? "Google Books" : "Open Library",
    matchScore: Math.round(matchScore),
    metadataScore: Math.round(computeMetadataScore(base)),
    finalScore: 0,
  };

  return rec;
}

// --- Seed resolution --------------------------------------------------------

export async function resolveRegularSeedBook(
  requestText: string,
): Promise<RegularSeedBook | null> {
  const cacheKey = `seed:${requestText.toLowerCase()}`;
  const cached = regularRecsCache.get<RegularSeedBook | null>(cacheKey);
  if (cached !== undefined) return cached;

  const [googleVolumes, openLibraryDocs] = await Promise.all([
    regularGoogleBooksSearch(requestText, 6).catch(() => [] as RegularGoogleVolumeInfo[]),
    regularOpenLibrarySearch(requestText, 6).catch(() => [] as RegularOpenLibraryDoc[]),
  ]);

  const candidates: RegularSeedBook[] = [];

  for (const v of googleVolumes) {
    candidates.push({
      title: cleanText(v.title),
      author: Array.isArray(v.authors) ? v.authors.slice(0, 3).join(", ") : "",
      subjects: toStringArray(v.categories, 10),
      description: cleanText(v.description),
      releaseYear: extractYear(v.publishedDate),
      source: "Google Books",
    });
  }
  for (const d of openLibraryDocs) {
    candidates.push({
      title: cleanText(d.title),
      author: Array.isArray(d.author_name) ? d.author_name.slice(0, 3).join(", ") : "",
      subjects: toStringArray(d.subject, 10),
      description: "",
      releaseYear: firstNumber(d.first_publish_year),
      source: "Open Library",
    });
  }

  if (candidates.length === 0) {
    regularRecsCache.set(cacheKey, null, REGULAR_TTL_SEED);
    return null;
  }

  const scored = candidates
    .map((book) => ({
      book,
      score: scoreTitleAuthorMatch(requestText, "", book.title, book.author),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 28) {
    regularRecsCache.set(cacheKey, null, REGULAR_TTL_SEED);
    return null;
  }

  regularRecsCache.set(cacheKey, best.book, REGULAR_TTL_SEED);
  return best.book;
}

// Re-export for callers that need the key form used during dedupe.
export { normalizeKey };
