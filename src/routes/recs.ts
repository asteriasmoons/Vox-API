import { Router } from "express";

const router = Router();

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";

const MIN_RECOMMENDATION_YEAR = 2020;
const FINAL_RECOMMENDATION_COUNT = 10;
const AI_CANDIDATE_COUNT = 18;

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

function parseAiCandidates(rawContent: string): AiBookCandidate[] {
  const content = rawContent.trim();

  try {
    const parsed = JSON.parse(content);
    const books = Array.isArray(parsed) ? parsed : parsed.books;

    if (Array.isArray(books)) {
      return books
        .map((book) => ({
          title: cleanText(book?.title),
          author: cleanText(book?.author),
          summary: cleanText(book?.summary),
        }))
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
            .map((book) => ({
              title: cleanText(book?.title),
              author: cleanText(book?.author),
              summary: cleanText(book?.summary),
            }))
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
        title: cleanText(titlePart?.replace(/["“”]/g, "")),
        author: cleanText(authorPart?.replace(/["“”]/g, "")),
        summary: "",
      };
    })
    .filter((book) => book.title);
}

async function groqRecommendCandidates(searchText: string): Promise<AiBookCandidate[]> {
  const apiKey = process.env.GROQ_API_KEY || "";

  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  const prompt = `You are Lumey's similarity-first book recommendation engine.

The user searched for: "${searchText}"

Generate ${AI_CANDIDATE_COUNT} real book recommendations that are as close as possible to what the user searched for.

Recommendation priority:
1. If the search looks like a specific book title, treat it as "recommend books like this book."
2. Prioritize close matches over variety.
3. Match the original book's primary genre/subgenre first.
4. Match tone, pacing, emotional intensity, romance level, darkness level, stakes, audience age category, tropes, themes, and character dynamics.
5. Prefer books first published in ${MIN_RECOMMENDATION_YEAR} or later.
6. Include older books only if they are an unusually strong similarity match.

Avoid:
- Do not give random books from the same broad genre.
- Do not recommend classics unless the user specifically asks for classics.
- Do not recommend the searched book itself.
- Do not invent fake books.
- Do not recommend books only because they are popular.
- Do not make every result from the same author unless the author is clearly the best match.
- Do not drift into unrelated subgenres.

Quality rules:
- If the user typed a book title, every recommendation should feel like it belongs on a "read this next if you liked that" shelf.
- If the user typed a genre, vibe, trope, or theme, recommend books that strongly match that exact request.
- Include a proper book summary for each recommended book, not a similarity explanation.
- The summary should describe the recommended book itself in 2-3 clear sentences.
- Do not say phrases like "same kind of book," "similar to the searched book," "if you liked that," or "this is a good match because."
- Use current, real books with verifiable title and author names.

Return JSON only.
Format: {"books":[{"title":"Book Title","author":"Author Name","summary":"Proper 2-3 sentence summary of this recommended book"}]}`;

  console.log("Groq recommendation request:", { searchText, model: GROQ_MODEL });

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.7,
      max_tokens: 1600,
      messages: [
        {
          role: "system",
          content:
            "You recommend real books and return strict JSON only. Do not include markdown, commentary, or extra prose.",
        },
        {
          role: "user",
          content: prompt,
        },
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

  const content = cleanText(json?.choices?.[0]?.message?.content);
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

    const bestDoc = docs.find((doc) => {
      const year = firstNumber(doc.first_publish_year);
      return typeof year === "number" && year >= MIN_RECOMMENDATION_YEAR;
    });

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

    const bestVolume = volumes.find((volume) => {
      const year = extractYear(volume.publishedDate);
      return typeof year === "number" && year >= MIN_RECOMMENDATION_YEAR;
    });

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

  const title = cleanText(googleBooks?.title) || cleanText(openLibrary?.title) || cleanText(candidate.title);
  const author = cleanText(googleBooks?.author) || cleanText(openLibrary?.author) || cleanText(candidate.author);
  const releaseYear = googleBooks?.releaseYear ?? openLibrary?.releaseYear;

  if (!title || !releaseYear || releaseYear < MIN_RECOMMENDATION_YEAR) {
    return null;
  }

  const tags = uniqueStrings([...(googleBooks?.tags ?? []), ...(openLibrary?.tags ?? [])]).slice(0, 10);

  return {
    title,
    author,
    summary:
      cleanText(googleBooks?.summary) ||
      cleanText(candidate.summary) ||
      "No description available.",
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
    const candidates = await groqRecommendCandidates(searchText);

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
