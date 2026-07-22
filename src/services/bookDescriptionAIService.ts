import { bookDescriptionGroqModel } from "./groqModelConfig";
import { recommendationCacheService } from "./recommendationCacheService";

const GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";

const DESCRIPTION_TIMEOUT_MS = 25_000;
const DESCRIPTION_RETRIES = 1;
const DESCRIPTION_CONCURRENCY = 2;
const DESCRIPTION_MAX_TOKENS = 520;
const unavailablePlaceholder = (noun: "description" | "summary") =>
  `no ${noun} available`;
const EMPTY_DESCRIPTION_SENTINELS = new Set([
  unavailablePlaceholder("description"),
  `${unavailablePlaceholder("description")}.`,
  unavailablePlaceholder("summary"),
  `${unavailablePlaceholder("summary")}.`,
]);

type GroqDescriptionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
};

type BookDescriptionInput = {
  title: string;
  author?: string;
  summary?: string;
};

type BookDescriptionOptions = {
  groqModel?: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDescription(value: string): string {
  return value
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function forceTwoParagraphs(value: string): string {
  const description = normalizeDescription(value);
  const paragraphs = description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length >= 2) {
    return `${paragraphs[0]}\n\n${paragraphs.slice(1).join("\n\n")}`;
  }

  const sentences = description.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!sentences || sentences.length < 4) return description;

  const midpoint = Math.ceil(sentences.length / 2);
  const first = sentences.slice(0, midpoint).join(" ").replace(/\s+/g, " ").trim();
  const second = sentences.slice(midpoint).join(" ").replace(/\s+/g, " ").trim();

  return second ? `${first}\n\n${second}` : description;
}

export function hasUsableBookDescription(value: unknown): value is string {
  const text = cleanText(value);
  if (!text) return false;
  return !EMPTY_DESCRIPTION_SENTINELS.has(text.toLowerCase());
}

function parseDescription(raw: string): string {
  const content = raw.trim();
  if (!content) return "";

  try {
    const parsed = JSON.parse(content) as { description?: unknown };
    return normalizeDescription(cleanText(parsed.description));
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return normalizeDescription(content);

    try {
      const parsed = JSON.parse(match[0]) as { description?: unknown };
      return normalizeDescription(cleanText(parsed.description));
    } catch {
      return normalizeDescription(content);
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateDescription(
  input: BookDescriptionInput,
  options?: BookDescriptionOptions,
): Promise<string> {
  const title = cleanText(input.title);
  const author = cleanText(input.author);
  if (!title) return "";

  const cached = recommendationCacheService.getGeneratedDescription(title, author);
  if (cached) return cached;

  const apiKey = process.env.GROQ_API_KEY || "";
  if (!apiKey) return "";

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= DESCRIPTION_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DESCRIPTION_TIMEOUT_MS);

    try {
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options?.groqModel ?? bookDescriptionGroqModel(),
          temperature: 0.35,
          max_tokens: DESCRIPTION_MAX_TOKENS,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You write careful, reader-facing book descriptions. Return strict JSON only. Do not invent spoilers, endings, awards, publication facts, or character names if you are unsure.",
            },
            {
              role: "user",
              content: `Write exactly two polished paragraphs describing the published book "${title}"${author ? ` by ${author}` : ""}. Each paragraph should be 2-4 sentences. Focus on premise, genre, tone, themes, and the reading experience. Do not use headings, bullets, markdown, quotation marks around the title, or availability placeholders. Return JSON shaped like {"description":"paragraph one\\n\\nparagraph two"}.`,
            },
          ],
        }),
        signal: controller.signal,
      });

      const json = (await response.json().catch(() => null)) as
        | GroqDescriptionResponse
        | null;

      if (!response.ok) {
        throw new Error(
          JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            body: json,
          }),
        );
      }

      const description = forceTwoParagraphs(
        parseDescription(cleanText(json?.choices?.[0]?.message?.content)),
      );

      if (hasUsableBookDescription(description)) {
        recommendationCacheService.setGeneratedDescription(title, author, description);
        return description;
      }

      return "";
    } catch (error) {
      lastError = error;
      if (attempt >= DESCRIPTION_RETRIES) break;
      await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error("Generated book description failed:", { title, author }, lastError);
  return "";
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

export const bookDescriptionAIService = {
  async ensureDescription(
    input: BookDescriptionInput,
    options?: BookDescriptionOptions,
  ): Promise<string> {
    if (hasUsableBookDescription(input.summary)) {
      return normalizeDescription(cleanText(input.summary));
    }

    return generateDescription(input, options);
  },

  async ensureDescriptions<T extends BookDescriptionInput>(
    books: T[],
    options?: BookDescriptionOptions,
  ): Promise<Array<T & { summary: string }>> {
    return mapWithBoundedConcurrency(
      books,
      DESCRIPTION_CONCURRENCY,
      async (book) => ({
        ...book,
        summary: await this.ensureDescription(book, options),
      }),
    );
  },
};
