import { regularCerebrasChatJson } from "./regularRecs/regularRecsProviders";

export interface ReadingInsightReviewBookInput {
  title: string;
  author: string;
  subtitle?: string;
  genres: string[];
  moods: string[];
  topics: string[];
  tags: string[];
  tropes: string[];
  rating?: number;
}

export interface ReadingInsightReviewInsightInput {
  dateCreated: string;
  sessionDate?: string;
  sessionMinutes?: number;
  sessionPages?: number;
  whatHappened: string;
  whatStoodOut: string;
  howIFeel: string;
  predictions: string;
  favoriteMoment: string;
  favoriteQuote: string;
  aiSummary: string;
}

export interface ReadingInsightReviewRequestInput {
  book: ReadingInsightReviewBookInput;
  insights: ReadingInsightReviewInsightInput[];
}

export interface ReadingInsightReviewOutput {
  title: string;
  content: string;
}

interface AIReviewPayload {
  title?: unknown;
  content?: unknown;
}

export async function generateReadingInsightReview(
  input: ReadingInsightReviewRequestInput,
): Promise<ReadingInsightReviewOutput> {
  const bookTitle = cleanText(input.book.title);
  const author = cleanText(input.book.author);
  const insights = input.insights
    .map(normalizeInsight)
    .filter((insight) => insightText(insight).length > 0);

  if (!bookTitle) {
    throw new Error("Book title is required");
  }
  if (insights.length === 0) {
    throw new Error("At least one reading insight is required");
  }

  const systemPrompt = [
    "You create polished book reviews for Lumey from a reader's saved reading insights.",
    "Use the reader's insights as the source of truth.",
    "Do not invent plot points, opinions, characters, events, endings, ratings, or reading history.",
    "Avoid spoilers unless the user's own insight text explicitly included them, and even then keep the review spoiler-light.",
    "Write in a natural first-person reviewer voice, as if the reader is turning their own notes into a finished review.",
    "Return strict JSON only."
  ].join(" ");

  const userPrompt = buildPrompt({
    book: {
      ...input.book,
      title: bookTitle,
      author,
      subtitle: cleanText(input.book.subtitle),
      genres: cleanArray(input.book.genres, 8),
      moods: cleanArray(input.book.moods, 8),
      topics: cleanArray(input.book.topics, 8),
      tags: cleanArray(input.book.tags, 12),
      tropes: cleanArray(input.book.tropes, 8),
    },
    insights,
  });

  const raw = await regularCerebrasChatJson(systemPrompt, userPrompt, {
    temperature: 0.55,
    maxTokens: 1500,
  });

  const parsed = parseReviewJSON(raw);
  const title = cleanText(parsed.title).slice(0, 90);
  const content = cleanReviewContent(parsed.content);

  if (!title || !content) {
    throw new Error("Cerebras returned an incomplete reading insight review");
  }

  return { title, content };
}

function buildPrompt(input: ReadingInsightReviewRequestInput): string {
  const book = input.book;
  const metadata = [
    book.subtitle ? `Subtitle: ${book.subtitle}` : "",
    book.author ? `Author: ${book.author}` : "",
    book.genres.length ? `Genres: ${book.genres.join(", ")}` : "",
    book.moods.length ? `Moods: ${book.moods.join(", ")}` : "",
    book.topics.length ? `Topics: ${book.topics.join(", ")}` : "",
    book.tags.length ? `Tags: ${book.tags.join(", ")}` : "",
    book.tropes.length ? `Tropes: ${book.tropes.join(", ")}` : "",
    typeof book.rating === "number" && Number.isFinite(book.rating) && book.rating > 0
      ? `Reader rating: ${book.rating}/5`
      : "",
  ].filter(Boolean);

  const insights = input.insights.map((insight, index) => {
    const sessionBits = [
      insight.sessionDate ? `Session date: ${insight.sessionDate}` : "",
      typeof insight.sessionMinutes === "number" ? `Minutes: ${insight.sessionMinutes}` : "",
      typeof insight.sessionPages === "number" ? `Pages: ${insight.sessionPages}` : "",
    ].filter(Boolean);

    return [
      `Insight ${index + 1}`,
      `Created: ${insight.dateCreated}`,
      ...sessionBits,
      insight.whatHappened ? `What happened: ${insight.whatHappened}` : "",
      insight.whatStoodOut ? `What stood out: ${insight.whatStoodOut}` : "",
      insight.howIFeel ? `How I felt: ${insight.howIFeel}` : "",
      insight.predictions ? `Predictions or questions: ${insight.predictions}` : "",
      insight.favoriteMoment ? `Notes and thoughts: ${insight.favoriteMoment}` : "",
      insight.favoriteQuote ? `Favorite quote: ${insight.favoriteQuote}` : "",
      insight.aiSummary ? `Existing AI summary: ${insight.aiSummary}` : "",
    ].filter(Boolean).join("\n");
  });

  return `Book:
Title: ${book.title}
${metadata.join("\n")}

Chronological reading insights:
${insights.join("\n\n")}

Create one finished book review from these insights.

Rules:
- The review should feel specific to this reader's experience with the book.
- Keep it coherent even if the insights were written across multiple sessions.
- Mention emotional response, standout patterns, questions, or shifts only when the insights support them.
- Do not mention "insights", "AI", "generated", or internal app language.
- Do not add a star rating unless the reader rating was supplied.
- Title should be short, human, and review-like.
- Content should be 2 to 4 concise paragraphs.
- No markdown.

Return JSON in this exact shape:
{
  "title": "review title",
  "content": "review body"
}`;
}

function normalizeInsight(value: ReadingInsightReviewInsightInput): ReadingInsightReviewInsightInput {
  const normalized: ReadingInsightReviewInsightInput = {
    dateCreated: cleanText(value.dateCreated),
    whatHappened: cleanText(value.whatHappened),
    whatStoodOut: cleanText(value.whatStoodOut),
    howIFeel: cleanText(value.howIFeel),
    predictions: cleanText(value.predictions),
    favoriteMoment: cleanText(value.favoriteMoment),
    favoriteQuote: cleanText(value.favoriteQuote),
    aiSummary: cleanText(value.aiSummary),
  };

  const sessionDate = cleanText(value.sessionDate);
  if (sessionDate) normalized.sessionDate = sessionDate;

  if (typeof value.sessionMinutes === "number" && Number.isFinite(value.sessionMinutes)) {
    normalized.sessionMinutes = value.sessionMinutes;
  }

  if (typeof value.sessionPages === "number" && Number.isFinite(value.sessionPages)) {
    normalized.sessionPages = value.sessionPages;
  }

  return normalized;
}

function insightText(insight: ReadingInsightReviewInsightInput): string {
  return [
    insight.whatHappened,
    insight.whatStoodOut,
    insight.howIFeel,
    insight.predictions,
    insight.favoriteMoment,
    insight.favoriteQuote,
    insight.aiSummary,
  ].join(" ").trim();
}

function parseReviewJSON(raw: string): AIReviewPayload {
  const cleaned = cleanText(raw);
  if (!cleaned) {
    throw new Error("Cerebras returned an empty reading insight review");
  }

  try {
    return JSON.parse(cleaned) as AIReviewPayload;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Cerebras returned invalid reading insight review JSON");
    }
    return JSON.parse(match[0]) as AIReviewPayload;
  }
}

function cleanReviewContent(value: unknown): string {
  return cleanText(value)
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 4000);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[ \t]+/g, " ") : "";
}

function cleanArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of value) {
    const cleaned = cleanText(item);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= limit) break;
  }

  return output;
}
