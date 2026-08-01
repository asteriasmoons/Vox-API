import { regularCerebrasChatJson } from "./regularRecs/regularRecsProviders";

const GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";

const CATALOG_TIMEOUT_MS = 12_000;
const AI_MAX_TOKENS = 1200;

type BookDetailsEnrichmentRequest = {
  title: string;
  author: string;
};

type CatalogCandidate = {
  source: "Google Books" | "Open Library";
  score: number;
  title: string;
  author: string;
  categories: string[];
  subjects: string[];
  subtitle?: string;
  publisher?: string;
  publicationYear?: number;
  isbn?: string;
  summary?: string;
  totalPages?: number;
};

type CatalogEvidence = {
  title: string;
  author: string;
  sources: string[];
  categories: string[];
  subjects: string[];
  subtitle?: string;
  publisher?: string;
  publicationYear?: number;
  isbn?: string;
  summary?: string;
  totalPages?: number;
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
  industryIdentifiers?: Array<{
    type?: string;
    identifier?: string;
  }>;
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
    subject?: string[];
    isbn?: string[];
    publisher?: string[];
    number_of_pages_median?: number;
  }>;
};

type AIBookDetails = {
  classification?: "fiction" | "nonfiction" | "unknown";
  summary?: string;
  genres?: string[];
  moods?: string[];
  topics?: string[];
  tags?: string[];
  tropes?: string[];
  seriesName?: string;
  seriesNumber?: string;
};

export type BookDetailsEnrichmentResponse = {
  subtitle: string | null;
  seriesName: string | null;
  seriesNumber: string | null;
  publisher: string | null;
  publicationYear: string | null;
  isbn: string | null;
  summary: string | null;
  totalPages: number | null;
  ebookTotalPages: number | null;
  totalChapters: number | null;
  genres: string[];
  moods: string[];
  topics: string[];
  tags: string[];
  tropes: string[];
  classification: "fiction" | "nonfiction" | "unknown";
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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
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

function labelFromValue(value: unknown): string {
  const text = cleanText(value)
    .replace(/[()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";

  const pieces = text
    .split(/[\/|;,]/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const candidate = pieces[0] ?? text;
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return "";

  return words
    .map((word) => word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ""))
    .filter(Boolean)
    .join(" ");
}

function cleanLabels(values: Array<unknown>, limit: number): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const label = labelFromValue(value);
    if (!label) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    results.push(label);

    if (results.length >= limit) break;
  }

  return results;
}

function extractYear(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;

  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function firstNumber(value: unknown): number | undefined {
  const num = typeof value === "string" ? Number(value) : value;
  return typeof num === "number" && Number.isFinite(num) ? num : undefined;
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
    score += 38;
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
      score += 24;
    }
  }

  return Math.min(score, 100);
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
  input: BookDetailsEnrichmentRequest,
): Promise<CatalogCandidate[]> {
  const url = new URL(GOOGLE_BOOKS_SEARCH_URL);
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || "";

  url.searchParams.set("q", `intitle:${input.title} inauthor:${input.author}`);
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

  return volumes
    .map((volume) => {
      const candidateAuthor = Array.isArray(volume.authors)
        ? volume.authors.slice(0, 3).join(", ")
        : input.author;
      const score = scoreTitleAuthorMatch(
        input.title,
        input.author,
        cleanText(volume.title),
        candidateAuthor,
      );
      const publicationYear = extractYear(volume.publishedDate);
      const totalPages = firstNumber(volume.pageCount);
      const isbn = googleISBN(volume);
      const candidate: CatalogCandidate = {
        source: "Google Books",
        score,
        title: cleanText(volume.title),
        author: candidateAuthor,
        categories: uniqueStrings(volume.categories ?? [], 12),
        subjects: [],
      };

      const subtitle = cleanText(volume.subtitle);
      const publisher = cleanText(volume.publisher);
      const summary = stripHtml(cleanText(volume.description));

      if (subtitle) candidate.subtitle = subtitle;
      if (publisher) candidate.publisher = publisher;
      if (publicationYear !== undefined) candidate.publicationYear = publicationYear;
      if (isbn) candidate.isbn = isbn;
      if (summary) candidate.summary = summary;
      if (totalPages !== undefined) candidate.totalPages = totalPages;

      return candidate;
    })
    .filter((candidate) => candidate.score >= 18)
    .sort((a, b) => b.score - a.score);
}

async function searchOpenLibrary(
  input: BookDetailsEnrichmentRequest,
): Promise<CatalogCandidate[]> {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);

  url.searchParams.set("q", `${input.title} ${input.author}`);
  url.searchParams.set("language", "eng");
  url.searchParams.set("limit", "8");
  url.searchParams.set(
    "fields",
    "title,author_name,first_publish_year,subject,isbn,publisher,number_of_pages_median",
  );

  const data = await fetchJson<OpenLibrarySearchResponse>(url);
  const docs = Array.isArray(data.docs) ? data.docs : [];

  return docs
    .filter((doc) => cleanText(doc.title))
    .map((doc) => {
      const candidateAuthor = Array.isArray(doc.author_name)
        ? doc.author_name.slice(0, 3).join(", ")
        : input.author;
      const score = scoreTitleAuthorMatch(
        input.title,
        input.author,
        cleanText(doc.title),
        candidateAuthor,
      );
      const publicationYear = firstNumber(doc.first_publish_year);
      const isbn = Array.isArray(doc.isbn)
        ? doc.isbn.find((value) => cleanText(value).length === 13) ??
          doc.isbn[0]
        : undefined;
      const publisher = Array.isArray(doc.publisher)
        ? doc.publisher[0]
        : undefined;
      const totalPages = firstNumber(doc.number_of_pages_median);
      const candidate: CatalogCandidate = {
        source: "Open Library",
        score,
        title: cleanText(doc.title),
        author: candidateAuthor,
        categories: [],
        subjects: uniqueStrings(doc.subject ?? [], 18),
      };

      if (publicationYear !== undefined) candidate.publicationYear = publicationYear;
      if (cleanText(isbn)) candidate.isbn = cleanText(isbn);
      if (cleanText(publisher)) candidate.publisher = cleanText(publisher);
      if (totalPages !== undefined) candidate.totalPages = totalPages;

      return candidate;
    })
    .filter((candidate) => candidate.score >= 18)
    .sort((a, b) => b.score - a.score);
}

function mergeCatalogEvidence(
  input: BookDetailsEnrichmentRequest,
  candidates: CatalogCandidate[],
): CatalogEvidence | null {
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const primary = ranked[0];
  if (!primary || primary.score < 35) return null;

  const google = ranked.find((candidate) => candidate.source === "Google Books");
  const openLibrary = ranked.find(
    (candidate) => candidate.source === "Open Library",
  );
  const sources = uniqueStrings(ranked.map((candidate) => candidate.source), 2);
  const publisher = google?.publisher ?? openLibrary?.publisher;
  const publicationYear = google?.publicationYear ?? openLibrary?.publicationYear;
  const isbn = google?.isbn ?? openLibrary?.isbn;
  const totalPages = google?.totalPages ?? openLibrary?.totalPages;
  const summary = google?.summary ?? openLibrary?.summary;
  const evidence: CatalogEvidence = {
    title: primary.title || input.title,
    author: primary.author || input.author,
    sources,
    categories: uniqueStrings(
      ranked.flatMap((candidate) => candidate.categories),
      18,
    ),
    subjects: uniqueStrings(
      ranked.flatMap((candidate) => candidate.subjects),
      24,
    ),
  };

  if (google?.subtitle) evidence.subtitle = google.subtitle;
  if (publisher) evidence.publisher = publisher;
  if (publicationYear !== undefined) evidence.publicationYear = publicationYear;
  if (isbn) evidence.isbn = isbn;
  if (summary) evidence.summary = summary;
  if (totalPages !== undefined) evidence.totalPages = totalPages;

  return evidence;
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

function parseClassification(value: unknown): "fiction" | "nonfiction" | "unknown" {
  const text = cleanText(value).toLowerCase().replace(/[^a-z]/g, "");
  if (text === "fiction") return "fiction";
  if (text === "nonfiction") return "nonfiction";
  return "unknown";
}

function parseAIResponse(raw: string): AIBookDetails {
  const parsed = parseJsonObject(raw);
  if (!parsed) return {};

  const classification = parseClassification(parsed.classification);
  const ai: AIBookDetails = {
    classification,
    genres: cleanLabels(Array.isArray(parsed.genres) ? parsed.genres : [], 5),
    moods: cleanLabels(Array.isArray(parsed.moods) ? parsed.moods : [], 6),
    topics: cleanLabels(Array.isArray(parsed.topics) ? parsed.topics : [], 8),
    tags: cleanLabels(Array.isArray(parsed.tags) ? parsed.tags : [], 10),
    tropes: cleanLabels(Array.isArray(parsed.tropes) ? parsed.tropes : [], 8),
  };

  const summary = cleanText(parsed.summary);
  const seriesName = cleanText(parsed.seriesName).slice(0, 120);
  const seriesNumber = cleanText(parsed.seriesNumber).slice(0, 24);

  if (summary) ai.summary = summary;
  if (seriesName) ai.seriesName = seriesName;
  if (seriesNumber) ai.seriesNumber = seriesNumber;

  return ai;
}

async function generateAIEnrichment(
  input: BookDetailsEnrichmentRequest,
  catalog: CatalogEvidence,
): Promise<AIBookDetails> {
  const systemPrompt = [
    "You create accurate, premium book metadata for Lumey's Add Book form.",
    "Return valid JSON only.",
    "Stay truthful to the supplied catalog metadata and the real book.",
    "Never invent ISBNs, publishers, page counts, chapter counts, publication facts, awards, endings, or major spoilers.",
  ].join(" ");
  const userPrompt = [
    "Analyze this book and create a clean enrichment payload for a reader's personal library.",
    "Use catalog metadata as factual source of truth. Use your knowledge only for the spoiler-free summary and classification labels.",
    "Write the summary like excellent book-jacket copy: concrete, vivid, and compelling enough to make the reader want to read it, while still clearly explaining what the book is actually about.",
    "Do not spoil major twists, reveals, or the ending.",
    "For fiction, focus on premise, protagonist or central cast, tension, setting, stakes, emotional pull, and why the situation matters.",
    "For nonfiction, focus on the core subject, argument or promise, what the reader will understand or gain, and why the ideas matter.",
    "Do not use phrases like 'the story follows', 'the book explores', 'readers who enjoy', 'perfect for fans of', or 'this compelling novel'.",
    "Choose classification as exactly fiction, nonfiction, or unknown.",
    "Genres, moods, topics, tags, and tropes must each be one to two words only, realistic, specific, and not duplicates of each other.",
    "If classification is fiction: return moods and tropes, and return topics as an empty array.",
    "If classification is nonfiction: return topics, and return moods and tropes as empty arrays.",
    "If classification is unknown: return only genres and tags, and leave moods, topics, and tropes empty.",
    "Only return seriesName and seriesNumber when the supplied metadata or reliable book knowledge clearly supports the book being in a series. Otherwise return null for both.",
    "Do not return ebookTotalPages or totalChapters. Lumey only fills those when source metadata explicitly provides them.",
    "",
    "User-entered identity:",
    JSON.stringify(input, null, 2),
    "",
    "Catalog evidence:",
    JSON.stringify(catalog, null, 2),
    "",
    "Return this exact JSON shape:",
    JSON.stringify(
      {
        classification: "fiction",
        summary: "two concise spoiler-free polished paragraphs",
        genres: ["Genre"],
        moods: ["Mood"],
        topics: [],
        tags: ["Tag"],
        tropes: ["Trope"],
        seriesName: null,
        seriesNumber: null,
      },
      null,
      2,
    ),
  ].join("\n");

  console.log("[book-details-enrichment] cerebras request", {
    title: input.title,
    author: input.author,
    promptChars: userPrompt.length,
  });

  const startedAt = Date.now();
  const raw = await regularCerebrasChatJson(systemPrompt, userPrompt, {
    temperature: 0.28,
    maxTokens: AI_MAX_TOKENS,
  });
  const parsed = parseAIResponse(raw);

  if (!cleanText(parsed.summary)) {
    throw new Error("Cerebras book details enrichment returned no usable summary");
  }

  console.log("[book-details-enrichment] cerebras success", {
    title: input.title,
    author: input.author,
    durationMs: Date.now() - startedAt,
    outputLength: raw.length,
    classification: parsed.classification,
    genres: parsed.genres?.length ?? 0,
    tags: parsed.tags?.length ?? 0,
  });

  return parsed;
}

function buildResponse(
  catalog: CatalogEvidence,
  ai: AIBookDetails,
): BookDetailsEnrichmentResponse {
  const classification = ai.classification ?? "unknown";
  const genres = cleanLabels([...(ai.genres ?? []), ...catalog.categories], 5);
  const tags = cleanLabels([...(ai.tags ?? []), ...catalog.subjects], 10);
  const moods =
    classification === "fiction" ? cleanLabels(ai.moods ?? [], 6) : [];
  const topics =
    classification === "nonfiction" ? cleanLabels(ai.topics ?? [], 8) : [];
  const tropes =
    classification === "fiction" ? cleanLabels(ai.tropes ?? [], 8) : [];

  return {
    subtitle: catalog.subtitle ?? null,
    seriesName: ai.seriesName ?? null,
    seriesNumber: ai.seriesNumber ?? null,
    publisher: catalog.publisher ?? null,
    publicationYear:
      catalog.publicationYear !== undefined ? String(catalog.publicationYear) : null,
    isbn: catalog.isbn ?? null,
    summary: ai.summary ?? catalog.summary ?? null,
    totalPages: catalog.totalPages ?? null,
    ebookTotalPages: null,
    totalChapters: null,
    genres,
    moods,
    topics,
    tags,
    tropes,
    classification,
    source: catalog.sources.join(" + "),
  };
}

export async function enrichBookDetails(
  input: BookDetailsEnrichmentRequest,
): Promise<BookDetailsEnrichmentResponse> {
  const title = cleanText(input.title);
  const author = cleanText(input.author);

  if (!title || !author) {
    throw new Error("Book title and author are required");
  }

  const request = { title: title.slice(0, 160), author: author.slice(0, 120) };
  console.log("[book-details-enrichment] start", request);

  const [googleCandidates, openLibraryCandidates] = await Promise.all([
    searchGoogleBooks(request).catch((error) => {
      console.error("[book-details-enrichment] google lookup failed", {
        ...request,
        message: error instanceof Error ? error.message : String(error),
      });
      return [] as CatalogCandidate[];
    }),
    searchOpenLibrary(request).catch((error) => {
      console.error("[book-details-enrichment] open library lookup failed", {
        ...request,
        message: error instanceof Error ? error.message : String(error),
      });
      return [] as CatalogCandidate[];
    }),
  ]);

  const catalog = mergeCatalogEvidence(request, [
    ...googleCandidates,
    ...openLibraryCandidates,
  ]);

  if (!catalog) {
    throw new Error("No confident Google Books or Open Library match was found");
  }

  const ai = await generateAIEnrichment(request, catalog);
  const response = buildResponse(catalog, ai);

  console.log("[book-details-enrichment] complete", {
    ...request,
    source: response.source,
    classification: response.classification,
    genres: response.genres.length,
    tags: response.tags.length,
  });

  return response;
}
