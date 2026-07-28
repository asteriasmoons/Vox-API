//
//  regularRecsBookSummary.ts
//  On-demand "Get Details" summary for a single REGULAR-recs book.
//  Reuses the collections book-detail COPYWRITER prompt, but runs on CEREBRAS
//  (regularCerebrasChatJson). Self-contained; cached in the regularRecs cache.
//

import { regularCerebrasChatJson } from "./regularRecsProviders";
import { regularRecsCache } from "./regularRecsCache";
import { cleanText, normalizeKey, parseJsonLoose } from "./regularRecsUtils";

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

// Same copywriter voice as the collections book-detail service.
const SYSTEM_PROMPT = [
  "You are Lumey's book discovery copywriter for recommended book detail pages.",
  "Your job is to make a reader think, 'oooo I want to read that,' while staying truthful to the supplied metadata.",
  "Return valid JSON only.",
  "Do not invent publication facts, ISBNs, publishers, awards, or endings.",
  "Do not write generic book-report prose.",
  "Do not reuse the shelf summary or catalog description verbatim.",
].join(" ");

function buildUserPrompt(input: RegularRecSummaryInput): string {
  return [
    "Build a compelling summary for a recommended book in Lumey.",
    "Use the supplied metadata (and your knowledge of this specific real book) as the source of truth.",
    "Write an original summary from scratch. Never paraphrase or lightly rewrite any provided description.",
    "Each paragraph should contain at least four complete, flowing sentences.",
    "The writing should feel elegant, cinematic, emotionally intelligent, vivid, polished, and highly readable.",
    "Your sole objective is to make the reader desperately want to pick up this book.",
    "The summary should create curiosity, emotional investment, fascination, or excitement before the reader reaches the final sentence.",
    "Do NOT begin by identifying the genre or describing the book from a distance.",
    "Do NOT sound like a review, encyclopedia, publisher description, AI assistant, or marketing copy.",
    "Never write phrases like 'this book explores', 'the author examines', 'perfect for fans of', 'readers who enjoy', 'this compelling novel', 'this insightful guide', or similar generic language.",
    "First determine what kind of book this is from the supplied metadata.",
    "Adapt your writing naturally to that type of book instead of forcing it into a fiction or nonfiction template.",
    "If it is fiction:",
    "Immerse the reader immediately into the emotional heart of the story. Introduce people, places, mysteries, relationships, dangers, dreams, impossible choices, or unanswered questions that make the world feel alive. Build tension and curiosity naturally without revealing spoilers. Leave the reader wondering what happens next.",
    "If it is nonfiction:",
    "Lead with the fascinating question, surprising truth, life-changing idea, remarkable story, or powerful insight that sits at the heart of the book. Show why this subject matters emotionally, intellectually, or personally. Make the reader feel they are about to discover something that could genuinely change how they see the world.",
    "If it is memoir or biography:",
    "Bring the person to life. Focus on the moments, struggles, triumphs, contradictions, relationships, or defining experiences that make their journey unforgettable. Create emotional curiosity rather than simply recounting events.",
    "If it is practical nonfiction such as self-help, psychology, business, health, productivity, spirituality, or personal growth:",
    "Do not list topics or lessons. Instead, make the reader feel the transformation waiting inside the book. Highlight the problems it helps solve, the perspectives it challenges, or the possibilities it opens without sounding instructional or sales-like.",
    "Regardless of genre:",
    "Write with the confidence and elegance of an experienced literary editor introducing an extraordinary book. Every sentence should deepen curiosity and create momentum. The reader should feel that stopping now would mean missing something remarkable.",
    "Every sentence should increase curiosity.",
    "Every paragraph should reveal just enough to make the reader crave more.",
    "Make the reader feel there is something remarkable waiting inside these pages.",
    "Never invent facts, characters, events, awards, or themes that are unsupported by the book.",
    "Never include spoilers or major reveals.",
    "The final sentence should leave the reader with a lingering feeling of curiosity, wonder, anticipation, or urgency to begin reading.",
    "Never merely explain what the book is about. Reveal just enough to ignite curiosity while deliberately leaving the most interesting questions unanswered.",
    "After reading the summary, the ideal reaction should be: '...Okay. I need to read this book.'",
    "Return strict JSON only. The summary field is required and must be two concise, polished paragraphs.",
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
    "Return this exact shape:",
    '{"summary":"two concise polished paragraphs"}',
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

  const content = await regularCerebrasChatJson(SYSTEM_PROMPT, buildUserPrompt(input), {
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
