import { Router } from "express";

const router = Router();

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";

const MIN_RECOMMENDATION_YEAR = 2016;
const FINAL_RECOMMENDATION_COUNT = 10;
const AI_CANDIDATE_COUNT = 30;

const GROQ_TEMPERATURE_ANALYZE = 0.2;
const GROQ_TEMPERATURE_RECOMMEND = 0.3;
const GROQ_MAX_TOKENS_ANALYZE = 500;
const GROQ_MAX_TOKENS_RECOMMEND = 1800;

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

type AiBookCandidate = {
  title: string;
  author?: string;
  summary?: string;
};

type LumeyBookRec = {
  title: string;
  author: string;
  summary: string;
  coverUrl?: string | undefined;
  pages?: number | undefined;
  releaseYear?: number | undefined;
  rating?: number | undefined;
  tags?: string[] | undefined;
  source?: string | undefined;
};

type SeedBook = {
  title: string;
  author: string;
  subjects: string[];
  description: string;
  releaseYear?: number;
  source?: string;
};

type SeedBookProfile = {
  genre: string;
  subgenres: string[];
  tone: string;
  pacing: string;
  audience: string;
  romance_level: string;
  darkness_level: string;
  key_tropes: string[];
  themes: string[];
};

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
};

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

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAuthor(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(title: string, author: string): string {
  return `${normalizeTitle(title)}|${normalizeAuthor(author)}`;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return values
    .map((value) => cleanText(value))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function dedupeRecommendations(recs: LumeyBookRec[]): LumeyBookRec[] {
  const seen = new Set<string>();

  return recs.filter((rec) => {
    const key = `${normalizeTitle(rec.title)}|${normalizeAuthor(rec.author)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreTitleAuthorMatch(
  targetTitle: string,
  targetAuthor: string,
  candidateTitle: string,
  candidateAuthor: string
): number {
  const normTargetTitle = normalizeTitle(targetTitle);
  const normTargetAuthor = normalizeAuthor(targetAuthor);
  const normCandidateTitle = normalizeTitle(candidateTitle);
  const normCandidateAuthor = normalizeAuthor(candidateAuthor);

  if (!normCandidateTitle) return 0;

  let score = 0;

  if (normTargetTitle && normCandidateTitle === normTargetTitle) {
    score += 50;
  } else if (
    normTargetTitle &&
    (normCandidateTitle.includes(normTargetTitle) || normTargetTitle.includes(normCandidateTitle))
  ) {
    score += 30;
  } else if (normTargetTitle) {
    const targetWords = normTargetTitle.split(" ").filter((word) => word.length > 2);
    const candidateWords = normCandidateTitle.split(" ");
    const overlap = targetWords.filter((word) =>
      candidateWords.some((candidateWord) => candidateWord.includes(word) || word.includes(candidateWord))
    ).length;
    score += overlap * 10;
  }

  if (normTargetAuthor && normCandidateAuthor) {
    if (normCandidateAuthor === normTargetAuthor) {
      score += 25;
    } else if (
      normCandidateAuthor.includes(normTargetAuthor) ||
      normTargetAuthor.includes(normCandidateAuthor)
    ) {
      score += 15;
    }
  }

  return score;
}

function scoreSeedMatch(query: string, title: string, author: string): number {
  return scoreTitleAuthorMatch(query, "", title, author);
}

function pickBestOpenLibraryDoc(docs: OpenLibraryDoc[], candidate: AiBookCandidate): OpenLibraryDoc | null {
  if (docs.length === 0) return null;

  const scored = docs
    .map((doc) => {
      const docTitle = cleanText(doc.title);
      const docAuthor = Array.isArray(doc.author_name) ? doc.author_name[0] ?? "" : "";
      const year = firstNumber(doc.first_publish_year);
      let score = scoreTitleAuthorMatch(candidate.title, candidate.author ?? "", docTitle, docAuthor);

      if (typeof year === "number" && year >= MIN_RECOMMENDATION_YEAR) {
        score += 10;
      }

      return { doc, score, year };
    })
    .sort((a, b) => b.score - a.score);

  const withValidYear = scored.find(
    (entry) => entry.score > 0 && typeof entry.year === "number" && entry.year >= MIN_RECOMMENDATION_YEAR
  );
  if (withValidYear) return withValidYear.doc;

  const bestScored = scored.find((entry) => entry.score > 0);
  if (bestScored) return bestScored.doc;

  return docs[0] ?? null;
}

function pickBestGoogleVolume(volumes: GoogleVolumeInfo[], candidate: AiBookCandidate): GoogleVolumeInfo | null {
  if (volumes.length === 0) return null;

  const scored = volumes
    .map((volume) => {
      const volumeTitle = cleanText(volume.title);
      const volumeAuthor = Array.isArray(volume.authors) ? volume.authors[0] ?? "" : "";
      const year = extractYear(volume.publishedDate);
      let score = scoreTitleAuthorMatch(candidate.title, candidate.author ?? "", volumeTitle, volumeAuthor);

      if (typeof year === "number" && year >= MIN_RECOMMENDATION_YEAR) {
        score += 10;
      }

      return { volume, score, year };
    })
    .sort((a, b) => b.score - a.score);

  const withValidYear = scored.find(
    (entry) => entry.score > 0 && typeof entry.year === "number" && entry.year >= MIN_RECOMMENDATION_YEAR
  );
  if (withValidYear) return withValidYear.volume;

  const bestScored = scored.find((entry) => entry.score > 0);
  if (bestScored) return bestScored.volume;

  return volumes[0] ?? null;
}

function parseAiCandidates(rawContent: string): AiBookCandidate[] {
  const content = rawContent.trim();

  try {
    const parsed = JSON.parse(content);
    const books = Array.isArray(parsed) ? parsed : parsed.books;

    if (Array.isArray(books)) {
      return books
        .map((book) => {
          const summary = cleanText(book?.summary);
          return {
            title: cleanText(book?.title),
            author: cleanText(book?.author),
            ...(summary ? { summary } : {}),
          };
        })
        .filter((book) => book.title);
    }
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const books = Array.isArray(parsed) ? parsed : parsed.books;

        if (Array.isArray(books)) {
          return books
            .map((book) => {
              const summary = cleanText(book?.summary);
              return {
                title: cleanText(book?.title),
                author: cleanText(book?.author),
                ...(summary ? { summary } : {}),
              };
            })
            .filter((book) => book.title);
        }
      } catch {
        // Fall through to line parsing.
      }
    }
  }

  return content
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .map((line) => {
      const [titlePart, authorPart] = line.split(/\s+by\s+/i);
      return {
        title: cleanText(titlePart?.replace(/["""]/g, "")),
        author: cleanText(authorPart?.replace(/["""]/g, "")),
      };
    })
    .filter((book) => book.title);
}

function parseSeedBookProfile(rawContent: string): SeedBookProfile | null {
  const content = rawContent.trim();

  try {
    const parsed = JSON.parse(content);
    return {
      genre: cleanText(parsed.genre),
      subgenres: Array.isArray(parsed.subgenres)
        ? parsed.subgenres.map((value: unknown) => cleanText(value)).filter(Boolean)
        : [],
      tone: cleanText(parsed.tone),
      pacing: cleanText(parsed.pacing),
      audience: cleanText(parsed.audience),
      romance_level: cleanText(parsed.romance_level),
      darkness_level: cleanText(parsed.darkness_level),
      key_tropes: Array.isArray(parsed.key_tropes)
        ? parsed.key_tropes.map((value: unknown) => cleanText(value)).filter(Boolean)
        : [],
      themes: Array.isArray(parsed.themes)
        ? parsed.themes.map((value: unknown) => cleanText(value)).filter(Boolean)
        : [],
    };
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        genre: cleanText(parsed.genre),
        subgenres: Array.isArray(parsed.subgenres)
          ? parsed.subgenres.map((value: unknown) => cleanText(value)).filter(Boolean)
          : [],
        tone: cleanText(parsed.tone),
        pacing: cleanText(parsed.pacing),
        audience: cleanText(parsed.audience),
        romance_level: cleanText(parsed.romance_level),
        darkness_level: cleanText(parsed.darkness_level),
        key_tropes: Array.isArray(parsed.key_tropes)
          ? parsed.key_tropes.map((value: unknown) => cleanText(value)).filter(Boolean)
          : [],
        themes: Array.isArray(parsed.themes)
          ? parsed.themes.map((value: unknown) => cleanText(value)).filter(Boolean)
          : [],
      };
    } catch {
      return null;
    }
  }
}

async function groqChatJson(
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; max_tokens: number }
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY || "";

  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const json = (await response.json().catch(() => null)) as GroqChatResponse | null;

  if (!response.ok) {
    console.error("Groq API error:", {
      status: response.status,
      statusText: response.statusText,
      body: json,
    });

    throw new Error(
      JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        body: json,
      })
    );
  }

  return cleanText(json?.choices?.[0]?.message?.content);
}

function formatSeedContext(seedBook: SeedBook | null, searchText: string): string {
  if (!seedBook) {
    return `User search text (no verified seed book found): "${searchText}"`;
  }

  return [
    "Verified seed book:",
    `Title: ${seedBook.title}`,
    `Author: ${seedBook.author || "Unknown"}`,
    seedBook.subjects.length > 0 ? `Subjects/Tags: ${seedBook.subjects.join(", ")}` : "",
    seedBook.description ? `Description: ${seedBook.description.slice(0, 800)}` : "",
    seedBook.releaseYear ? `Publication year: ${seedBook.releaseYear}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function groqAnalyzeSeedBook(
  searchText: string,
  seedBook: SeedBook | null
): Promise<SeedBookProfile> {
  const seedContext = formatSeedContext(seedBook, searchText);

  const prompt = `Analyze the following book or reading request and return a concise similarity profile.

${seedContext}

Return JSON only with this exact shape:
{
  "genre": "primary genre",
  "subgenres": ["subgenre1", "subgenre2"],
  "tone": "overall tone",
  "pacing": "pacing style",
  "audience": "audience age category",
  "romance_level": "none/low/medium/high",
  "darkness_level": "light/medium/dark",
  "key_tropes": ["trope1", "trope2"],
  "themes": ["theme1", "theme2"]
}

Focus on what makes this book or request distinctive for similarity matching. Do not recommend books yet.`;

  console.log("Groq seed analysis request:", { searchText, model: GROQ_MODEL });

  const content = await groqChatJson(
    "You analyze books for similarity matching and return strict JSON only.",
    prompt,
    { temperature: GROQ_TEMPERATURE_ANALYZE, max_tokens: GROQ_MAX_TOKENS_ANALYZE }
  );

  const profile = parseSeedBookProfile(content);

  if (!profile) {
    console.warn("Failed to parse seed book profile, using fallback profile");
    return {
      genre: searchText,
      subgenres: [],
      tone: "",
      pacing: "",
      audience: "",
      romance_level: "",
      darkness_level: "",
      key_tropes: [],
      themes: [],
    };
  }

  console.log("Groq seed profile:", profile);
  return profile;
}

async function groqRecommendCandidates(
  searchText: string,
  seedBook: SeedBook | null,
  profile: SeedBookProfile
): Promise<AiBookCandidate[]> {
  const seedContext = formatSeedContext(seedBook, searchText);

  const prompt = `You are Lumey's strict book similarity engine.

${seedContext}

Similarity profile to match:
- Genre: ${profile.genre}
- Subgenres: ${profile.subgenres.join(", ") || "none specified"}
- Tone: ${profile.tone || "unspecified"}
- Pacing: ${profile.pacing || "unspecified"}
- Audience: ${profile.audience || "unspecified"}
- Romance level: ${profile.romance_level || "unspecified"}
- Darkness level: ${profile.darkness_level || "unspecified"}
- Key tropes: ${profile.key_tropes.join(", ") || "none specified"}
- Themes: ${profile.themes.join(", ") || "none specified"}

Recommend exactly ${AI_CANDIDATE_COUNT} real books that match these qualities as closely as possible.

Hard rules:
- If the seed is a specific book, recommend books LIKE that exact book, not just popular books near it.
- Stay in the same primary genre unless the user explicitly asks for cross-genre recommendations.
- Stay in the same audience category when possible (YA, New Adult, Adult, middle grade, nonfiction, etc.).
- Prioritize exact subgenre matches over broad genre matches.
- Prioritize close tone, pacing, stakes, romance level, darkness level, and trope matches over variety.
- Do not recommend the seed book itself.
- Do not recommend duplicate titles.
- Do not recommend books from unrelated genres.
- Do not recommend books only because they are popular on BookTok, Goodreads, or bestseller lists.
- Do not invent fake books.
- Do NOT include summaries — title and author only.

Return JSON only.
Format: {"books":[{"title":"Book Title","author":"Author Name"}]}`;

  console.log("Groq recommendation request:", { searchText, model: GROQ_MODEL });

  const content = await groqChatJson(
    "You recommend real books and return strict JSON only. Do not include markdown, commentary, summaries, or extra prose.",
    prompt,
    { temperature: GROQ_TEMPERATURE_RECOMMEND, max_tokens: GROQ_MAX_TOKENS_RECOMMEND }
  );

  const candidates = parseAiCandidates(content).slice(0, AI_CANDIDATE_COUNT);

  console.log("Groq candidates:", candidates.map((book) => `${book.title} by ${book.author || "Unknown"}`));

  return candidates;
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        body: json,
      })
    );
  }

  return json as T;
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
        author: Array.isArray(doc.author_name) ? doc.author_name.slice(0, 3).join(", ") : "",
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
    const key = normalizeKey(result.title, result.author);
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
      subjects: uniqueStrings([...existing.subjects, ...result.subjects]).slice(0, 12),
      description: existing.description || result.description,
      ...(releaseYear !== undefined ? { releaseYear } : {}),
      ...(source ? { source } : {}),
    });
  }

  return [...merged.values()];
}

async function resolveSeedBook(searchText: string): Promise<SeedBook | null> {
  const [openLibraryResults, googleBooksResults] = await Promise.all([
    searchOpenLibraryForSeed(searchText).catch((error) => {
      console.error("Open Library seed search failed:", error);
      return [] as SeedBook[];
    }),
    searchGoogleBooksForSeed(searchText).catch((error) => {
      console.error("Google Books seed search failed:", error);
      return [] as SeedBook[];
    }),
  ]);

  const candidates = mergeSeedResults([...googleBooksResults, ...openLibraryResults]);

  if (candidates.length === 0) {
    console.log("No seed book match found for:", searchText);
    return null;
  }

  const scored = candidates
    .map((book) => ({
      book,
      score: scoreSeedMatch(searchText, book.title, book.author),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (!best || best.score < 15) {
    console.log("No confident seed book match for:", searchText, {
      topCandidate: best?.book.title,
      score: best?.score,
    });
    return null;
  }

  console.log("Resolved seed book:", {
    title: best.book.title,
    author: best.book.author,
    score: best.score,
    source: best.book.source,
  });

  return best.book;
}

async function openLibraryLookup(candidate: AiBookCandidate): Promise<Partial<LumeyBookRec> | null> {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);
  const q = candidate.author ? `${candidate.title} ${candidate.author}` : candidate.title;

  url.searchParams.set("q", q);
  url.searchParams.set("language", "eng");
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "title,author_name,first_publish_year,cover_i,subject");

  try {
    const data = await fetchJson<OpenLibrarySearchResponse>(url);
    const docs = Array.isArray(data.docs) ? data.docs : [];

    const bestDoc = pickBestOpenLibraryDoc(docs, candidate);
    if (!bestDoc) return null;

    const year = firstNumber(bestDoc.first_publish_year);
    const coverId = firstNumber(bestDoc.cover_i);

    return {
      title: cleanText(bestDoc.title),
      author: Array.isArray(bestDoc.author_name) ? bestDoc.author_name.slice(0, 3).join(", ") : cleanText(candidate.author),
      releaseYear: year,
      coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
      tags: Array.isArray(bestDoc.subject) ? bestDoc.subject.slice(0, 8) : [],
      source: "Open Library",
    };
  } catch (error) {
    console.error("Open Library lookup failed:", candidate, error);
    return null;
  }
}

async function googleBooksLookup(candidate: AiBookCandidate): Promise<Partial<LumeyBookRec> | null> {
  const url = new URL(GOOGLE_BOOKS_SEARCH_URL);
  const q = candidate.author ? `intitle:${candidate.title} inauthor:${candidate.author}` : candidate.title;
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || "";

  url.searchParams.set("q", q);
  url.searchParams.set("printType", "books");
  url.searchParams.set("langRestrict", "en");
  url.searchParams.set("maxResults", "5");

  if (apiKey) {
    url.searchParams.set("key", apiKey);
  }

  try {
    const data = await fetchJson<GoogleBooksResponse>(url);
    const items = Array.isArray(data.items) ? data.items : [];

    const volumes = items
      .map((item) => item.volumeInfo)
      .filter((volume): volume is GoogleVolumeInfo => Boolean(volume?.title));

    const bestVolume = pickBestGoogleVolume(volumes, candidate);
    if (!bestVolume) return null;

    const year = extractYear(bestVolume.publishedDate);
    const imageUrl = cleanText(bestVolume.imageLinks?.thumbnail) || cleanText(bestVolume.imageLinks?.smallThumbnail);

    return {
      title: cleanText(bestVolume.title),
      author: Array.isArray(bestVolume.authors) ? bestVolume.authors.slice(0, 3).join(", ") : cleanText(candidate.author),
      summary: cleanText(bestVolume.description),
      coverUrl: imageUrl ? imageUrl.replace("http://", "https://") : undefined,
      pages: firstNumber(bestVolume.pageCount),
      releaseYear: year,
      rating: firstNumber(bestVolume.averageRating),
      tags: Array.isArray(bestVolume.categories) ? bestVolume.categories : [],
      source: "Google Books",
    };
  } catch (error) {
    console.error("Google Books lookup failed:", candidate, error);
    return null;
  }
}

async function buildRecommendation(candidate: AiBookCandidate): Promise<LumeyBookRec | null> {
  const [openLibrary, googleBooks] = await Promise.all([
    openLibraryLookup(candidate),
    googleBooksLookup(candidate),
  ]);

  if (!openLibrary && !googleBooks) {
    return null;
  }

  const title = cleanText(googleBooks?.title) || cleanText(openLibrary?.title) || cleanText(candidate.title);
  const author = cleanText(googleBooks?.author) || cleanText(openLibrary?.author) || cleanText(candidate.author);
  const releaseYear = googleBooks?.releaseYear ?? openLibrary?.releaseYear;

  if (!title) {
    return null;
  }

  if (typeof releaseYear === "number" && releaseYear < MIN_RECOMMENDATION_YEAR) {
    return null;
  }

  const tags = uniqueStrings([...(googleBooks?.tags ?? []), ...(openLibrary?.tags ?? [])]).slice(0, 10);

  return {
    title,
    author,
    summary: cleanText(googleBooks?.summary) || "No description available.",
    coverUrl: googleBooks?.coverUrl ?? openLibrary?.coverUrl,
    pages: googleBooks?.pages,
    releaseYear,
    rating: googleBooks?.rating,
    tags,
    source: googleBooks?.source ?? openLibrary?.source,
  };
}

/**
 * POST /api/books/recs
 * body: { genre: string }
 *
 * Returns: { recs: [{ title, author, summary }] }
 */
router.post("/", async (req, res) => {
  try {
    const genreRaw = String(req.body?.genre || "").trim();
    if (!genreRaw) {
      return res.status(400).json({ error: "Genre is required" });
    }

    const searchText = genreRaw.slice(0, 160);

    const seedBook = await resolveSeedBook(searchText);
    const profile = await groqAnalyzeSeedBook(searchText, seedBook);
    const candidates = await groqRecommendCandidates(searchText, seedBook, profile);

    if (candidates.length === 0) {
      return res.json({ recs: [] });
    }

    const recs = dedupeRecommendations(
      (await Promise.all(candidates.map(buildRecommendation)))
        .filter((rec): rec is LumeyBookRec => Boolean(rec))
    ).slice(0, FINAL_RECOMMENDATION_COUNT);

    console.log(
      "Final Lumey recommendations:",
      recs.map((rec) => ({ title: rec.title, author: rec.author, releaseYear: rec.releaseYear }))
    );

    return res.json({ recs });
  } catch (err) {
    console.error("Recommendations route error:", err);

    const message = err instanceof Error ? err.message : String(err);

    return res.status(500).json({
      error: "Failed to fetch recommendations",
      detail: message,
    });
  }
});

export default router;
