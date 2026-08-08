//
//  regularRecsBookSummary.ts
//  On-demand "Get Details" summary for a single REGULAR-recs book.
//  Reuses the collections book-detail COPYWRITER prompt, but runs on CEREBRAS
//  (regularCerebrasChatJson). Self-contained; cached in the regularRecs cache.
//

import { regularCerebrasChatJson } from "./regularRecsProviders";
import { regularRecsCache } from "./regularRecsCache";
import { cleanText, normalizeKey, parseJsonLoose } from "./regularRecsUtils";
import { searchGoogleBooks, searchOpenLibrary, type BookSearchResult } from "../../routes/bookSearch";

const SUMMARY_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface RegularRecSummaryInput {
  title: string;
  author: string;
  summary?: string | undefined;
  rationale?: string | undefined;
  strategyLabel?: string | undefined;
  genres?: string[] | undefined;
  moods?: string[] | undefined;
  tropes?: string[] | undefined;
  themes?: string[] | undefined;
  tags?: string[] | undefined;
  pages?: number | undefined;
  releaseYear?: number | undefined;
  rating?: number | undefined;
  source?: string | undefined;
}

// Clear, accurate book description — says what the book is actually about.
const SYSTEM_PROMPT = [
  "You are Lumey's book description writer.",
  "You write clear, accurate, and compelling descriptions that tell the reader what a book is actually about while making them want to read it.",
  "Return valid JSON only.",
  "Stay truthful to the real book. Never invent characters, plot points, facts, awards, or endings.",
  "Never be poetic, flowery, cryptic, vague, or riddling, and never withhold the premise to build mystery.",
].join(" ");

async function lookupBook(input: RegularRecSummaryInput): Promise<BookSearchResult | undefined> {
  const query = `${cleanText(input.title)} ${cleanText(input.author)}`.trim();
  const [google, openLibrary] = await Promise.all([
    searchGoogleBooks(query).catch(() => [] as BookSearchResult[]),
    searchOpenLibrary(query).catch(() => [] as BookSearchResult[]),
  ]);
  const wantedTitle = normalizeKey(input.title, "").split("|")[0];
  const wantedAuthor = normalizeKey("", input.author).split("|")[1];
  const candidates = [...google, ...openLibrary];
  return candidates.find((book) => {
    const key = normalizeKey(book.title, book.author);
    const [titleKey, authorKey] = key.split("|");
    return titleKey === wantedTitle && (!wantedAuthor || authorKey?.includes(wantedAuthor));
  }) ?? candidates.find((book) => normalizeKey(book.title, "").split("|")[0] === wantedTitle) ?? candidates[0];
}

function buildUserPrompt(input: RegularRecSummaryInput, lookup?: BookSearchResult): string {
  return [
    "Write a clear, accurate, and genuinely compelling description of this specific real book — one that actually tells the reader what the book is about AND makes them want to read it.",
    "The reader should finish your description understanding the book's premise, hooked, and able to decide whether they want to read it.",
    "In flowing prose, cover: who the main character or subject is; the setup and premise; the central conflict or question the book revolves around; the setting or world; and what is at stake (for fiction) or what the reader will learn or gain (for nonfiction).",
    "Write exactly two paragraphs. Each paragraph must be at least four complete sentences. Keep it substantial and worth reading.",
    "Write like the best book-jacket copy: vivid, confident, and compelling enough to pull the reader in — but ALWAYS grounded in what actually happens and what the book is truly about. Clarity and pull matter equally; deliver both.",
    "Open with a real hook — a concrete, intriguing detail about the character, premise, or stakes that grabs attention — never vague mood or scenery.",
    "Do not sound like an encyclopedia, plot summary, or book report. Never use flat, distancing phrases like 'the central conflict revolves around', 'the narrative follows', 'the story follows', 'readers gain', 'this book tells the story of', or 'the book is about'.",
    "ABSOLUTELY DO NOT be poetic, flowery, abstract, atmospheric-for-its-own-sake, cryptic, or vague. DO NOT write a riddle. DO NOT tease the reader or 'leave the interesting questions unanswered.' DO NOT withhold the premise to create mystery. If you are describing mood without stating what actually happens or what the book is about, you are doing it wrong.",
    "Avoid generic filler phrases such as 'this book explores', 'the author examines', 'perfect for fans of', 'readers who enjoy', 'a journey of', 'a tale of', 'this compelling novel', 'this insightful guide'.",
    "Adapt to the book type: for fiction, describe the protagonist, their situation, the central conflict, and the stakes; for nonfiction, describe the core subject, the main ideas or argument, and what the reader takes away; for memoir or biography, describe whose life it is and the defining experiences it covers; for practical nonfiction, describe the actual problem it addresses and what it teaches.",
    "Do not reveal major twists, spoilers, or the ending — but DO clearly describe the premise, setup, and what the book is actually about.",
    "Use the supplied metadata, verified lookup information, and your knowledge of this specific real book as the source of truth. The lookup information was fetched before generation specifically to ground your answer. Never paraphrase or lightly rewrite a provided description; synthesize the verified facts into your own description.",
    "Do not refuse merely because your own knowledge is incomplete. When verified lookup information is present, use it as factual grounding and write the requested description without inventing unsupported details.",
    "Return strict JSON only. The summary field is required and must be exactly two clear, informative paragraphs.",
    "",
    "Book:",
    JSON.stringify(
      {
        title: input.title,
        author: input.author,
        shelfReason: cleanText(input.rationale) || undefined,
        strategyLabel: cleanText(input.strategyLabel) || undefined,
        knownSummary: cleanText(input.summary) || undefined,
        genres: input.genres ?? [],
        moods: input.moods ?? [],
        tropes: input.tropes ?? [],
        themes: input.themes ?? [],
        tags: input.tags ?? [],
        releaseYear: input.releaseYear,
        pages: input.pages,
      },
      null,
      2,
    ),
    "",
    "Verified book lookup:",
    JSON.stringify(lookup ? {
      title: lookup.title,
      author: lookup.author,
      description: cleanText(lookup.summary) || undefined,
      publisher: lookup.publisher,
      isbn: lookup.isbn,
      releaseYear: lookup.releaseYear,
      pages: lookup.pages,
      rating: lookup.rating,
      subjects: lookup.tags ?? [],
      source: lookup.source,
    } : { found: false }, null, 2),
    "",
    "Return this exact shape:",
    '{"summary":"two clear, informative paragraphs that actually explain what the book is about"}',
  ].join("\n");
}

export async function buildRegularRecBookSummary(
  input: RegularRecSummaryInput,
): Promise<{ summary: string }> {
  const title = cleanText(input.title);
  const author = cleanText(input.author);
  if (!title || !author) {
    throw new Error("Book title and author are required");
  }

  const cacheKey = `summary:${normalizeKey(title, author)}`;
  const cached = regularRecsCache.get<string>(cacheKey);
  if (cached) return { summary: cached };

  // Ground the AI with current catalog information before asking it to write.
  const lookup = await lookupBook(input);
  console.log(`[RegularRecsSummary] lookup ${lookup ? "found" : "not found"}: ${title} — ${author}${lookup ? ` via ${lookup.source}` : ""}`);

  const content = await regularCerebrasChatJson(SYSTEM_PROMPT, buildUserPrompt(input, lookup), {
    temperature: 0.35,
    maxTokens: 1400,
  });

  const parsed = parseJsonLoose(content);
  const rawSummary =
    parsed && typeof parsed === "object"
      ? cleanText((parsed as Record<string, unknown>).summary)
      : "";
  // Some models escape paragraph breaks as literal "\n"; normalize to real ones.
  const summary = rawSummary
    .replace(/\\r\\n|\\n|\\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!summary) {
    throw new Error("Summary generation returned no usable text");
  }

  regularRecsCache.set(cacheKey, summary, SUMMARY_TTL);
  return { summary };
}
