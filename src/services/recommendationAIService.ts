import { recommendationCacheService } from "./recommendationCacheService";
import { recommendationGroqModel } from "./groqModelConfig";
import type {
  AiBookCandidate,
  CandidateGroup,
  RecommendationIntent,
  RecommendationProfile,
  RecommendationRequest,
  RecommendationRequestType,
  RecommendationStrategy,
  SeedBook,
} from "../types/recommendations";
import {
  RECOMMENDATION_REQUEST_TYPES,
  RECOMMENDATION_STRATEGIES,
} from "../types/recommendations";

const GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";

const ANALYZE_TEMPERATURE = 0.15;
const PROFILE_TEMPERATURE = 0.2;
const CANDIDATE_TEMPERATURE = 0.35;
const FALLBACK_TEMPERATURE = 0.45;
const ANALYZE_MAX_TOKENS = 700;
const HOME_ANALYZE_MAX_TOKENS = 350;
const PROFILE_MAX_TOKENS = 900;
const HOME_PROFILE_MAX_TOKENS = 500;
const CANDIDATE_MAX_TOKENS = 3200;
const HOME_CANDIDATE_MAX_TOKENS = 900;
const FALLBACK_MAX_TOKENS = 2200;
const HOME_FALLBACK_MAX_TOKENS = 700;
const GROQ_TIMEOUT_MS = 45_000;
const GROQ_RETRIES = 2;

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
};

type GroqOptions = {
  temperature: number;
  maxTokens: number;
  model?: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .slice(0, limit);
}

function isRecommendationRequestType(
  value: unknown,
): value is RecommendationRequestType {
  return (
    typeof value === "string" &&
    RECOMMENDATION_REQUEST_TYPES.includes(value as RecommendationRequestType)
  );
}

function isRecommendationStrategy(
  value: unknown,
): value is RecommendationStrategy {
  return (
    typeof value === "string" &&
    RECOMMENDATION_STRATEGIES.includes(value as RecommendationStrategy)
  );
}

function clampScore(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function parseJsonObject(raw: string): unknown | null {
  const content = raw.trim();
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function fallbackIntent(request: RecommendationRequest): RecommendationIntent {
  return {
    requestType: request.requestTypeHint ?? "natural_language",
    normalizedQuery: request.query,
    confidence: request.requestTypeHint ? 0.7 : 0.35,
    entities: {},
  };
}

function fallbackProfile(
  request: RecommendationRequest,
  intent: RecommendationIntent,
): RecommendationProfile {
  return {
    requestType: intent.requestType,
    query: intent.normalizedQuery || request.query,
    genre: intent.entities.genre ?? "",
    subgenres: intent.entities.subgenre ? [intent.entities.subgenre] : [],
    tone: "",
    pacing: "",
    audience: "",
    romanceLevel: "",
    darknessLevel: "",
    keyTropes: intent.entities.trope ? [intent.entities.trope] : [],
    themes: intent.entities.theme ? [intent.entities.theme] : [],
    moods: intent.entities.mood ? [intent.entities.mood] : [],
    authors: intent.entities.author ? [intent.entities.author] : [],
    comparableBooks: intent.entities.title
      ? [
          {
            title: intent.entities.title,
            ...(intent.entities.author ? { author: intent.entities.author } : {}),
          },
        ]
      : [],
  };
}

function formatSeedContext(seedBook: SeedBook | null, query: string): string {
  if (!seedBook) {
    return `No verified seed book. Reading request: "${query}"`;
  }

  return [
    "Verified seed book:",
    `Title: ${seedBook.title}`,
    `Author: ${seedBook.author || "Unknown"}`,
    seedBook.subjects.length > 0
      ? `Subjects and tags: ${seedBook.subjects.join(", ")}`
      : "",
    seedBook.description ? `Description: ${seedBook.description.slice(0, 900)}` : "",
    seedBook.releaseYear ? `Publication year: ${seedBook.releaseYear}` : "",
    seedBook.source ? `Catalog source: ${seedBook.source}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatProfile(profile: RecommendationProfile): string {
  return [
    `Request type: ${profile.requestType}`,
    `Query: ${profile.query}`,
    `Genre: ${profile.genre || "unspecified"}`,
    `Subgenres: ${profile.subgenres.join(", ") || "unspecified"}`,
    `Tone: ${profile.tone || "unspecified"}`,
    `Pacing: ${profile.pacing || "unspecified"}`,
    `Audience: ${profile.audience || "unspecified"}`,
    `Romance level: ${profile.romanceLevel || "unspecified"}`,
    `Darkness level: ${profile.darknessLevel || "unspecified"}`,
    `Tropes: ${profile.keyTropes.join(", ") || "unspecified"}`,
    `Themes: ${profile.themes.join(", ") || "unspecified"}`,
    `Moods: ${profile.moods.join(", ") || "unspecified"}`,
    `Authors: ${profile.authors.join(", ") || "unspecified"}`,
  ].join("\n");
}

function formatReaderContext(request: RecommendationRequest): string {
  const context = request.readerContext;
  if (!context) return "No reader-library context supplied.";

  return [
    "Reader-library context:",
    context.favoriteGenres?.length
      ? `Favorite genres: ${context.favoriteGenres.slice(0, 10).join(", ")}`
      : "",
    context.favoriteAuthors?.length
      ? `Favorite authors: ${context.favoriteAuthors.slice(0, 10).join(", ")}`
      : "",
    context.favoriteTropes?.length
      ? `Favorite tropes: ${context.favoriteTropes.slice(0, 10).join(", ")}`
      : "",
    context.favoriteMoods?.length
      ? `Favorite moods: ${context.favoriteMoods.slice(0, 10).join(", ")}`
      : "",
    context.favoriteTags?.length
      ? `Favorite tags: ${context.favoriteTags.slice(0, 12).join(", ")}`
      : "",
    context.ratings?.length
      ? `Rated books: ${context.ratings
          .slice(0, 20)
          .map((rating) => `${rating.title}${rating.author ? ` by ${rating.author}` : ""} (${rating.rating}/5)`)
          .join("; ")}`
      : "",
    context.pagePreferences
      ? `Preferred page range: ${context.pagePreferences.preferredMinPages ?? "?"}-${context.pagePreferences.preferredMaxPages ?? "?"}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function groqRateLimitDelayMs(error: unknown, attempt: number): number | null {
  if (!(error instanceof Error)) return null;

  try {
    const parsed = JSON.parse(error.message) as {
      status?: unknown;
      body?: {
        error?: {
          message?: unknown;
        };
      };
    };

    if (parsed.status !== 429) return null;

    const message =
      typeof parsed.body?.error?.message === "string"
        ? parsed.body.error.message
        : "";
    const retryMatch = message.match(/try again in\s+([\d.]+)s/i);
    const retrySeconds = retryMatch?.[1] ? Number(retryMatch[1]) : NaN;
    const retryMs = Number.isFinite(retrySeconds)
      ? Math.ceil(retrySeconds * 1000) + 500
      : 1200 * (attempt + 1);

    return Math.max(750, Math.min(retryMs, 20_000));
  } catch {
    return null;
  }
}

async function groqChatJson(
  systemPrompt: string,
  userPrompt: string,
  options: GroqOptions,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= GROQ_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    try {
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model ?? recommendationGroqModel(),
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      const json = (await response.json().catch(() => null)) as
        | GroqChatResponse
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

      return cleanText(json?.choices?.[0]?.message?.content);
    } catch (error) {
      lastError = error;
      if (attempt >= GROQ_RETRIES) break;
      await sleep(groqRateLimitDelayMs(error, attempt) ?? 350 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (
    typeof lastError === "object" &&
    lastError !== null &&
    "name" in lastError &&
    lastError.name === "AbortError"
  ) {
    throw new Error(`Groq request timed out after ${GROQ_TIMEOUT_MS / 1000}s`);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseIntent(raw: string, request: RecommendationRequest): RecommendationIntent {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== "object") return fallbackIntent(request);

  const record = parsed as Record<string, unknown>;
  const entities =
    record.entities && typeof record.entities === "object"
      ? (record.entities as Record<string, unknown>)
      : {};
  const requestType = isRecommendationRequestType(record.requestType)
    ? record.requestType
    : request.requestTypeHint ?? "natural_language";

  const intent: RecommendationIntent = {
    requestType,
    normalizedQuery: cleanText(record.normalizedQuery) || request.query,
    confidence: clampScore(record.confidence),
    entities: {},
  };

  const title = cleanText(entities.title);
  const author = cleanText(entities.author);
  const genre = cleanText(entities.genre);
  const subgenre = cleanText(entities.subgenre);
  const trope = cleanText(entities.trope);
  const theme = cleanText(entities.theme);
  const mood = cleanText(entities.mood);

  if (title) intent.entities.title = title;
  if (author) intent.entities.author = author;
  if (genre) intent.entities.genre = genre;
  if (subgenre) intent.entities.subgenre = subgenre;
  if (trope) intent.entities.trope = trope;
  if (theme) intent.entities.theme = theme;
  if (mood) intent.entities.mood = mood;

  return intent;
}

function parseProfile(
  raw: string,
  request: RecommendationRequest,
  intent: RecommendationIntent,
): RecommendationProfile {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return fallbackProfile(request, intent);
  }

  const record = parsed as Record<string, unknown>;
  const requestType = isRecommendationRequestType(record.requestType)
    ? record.requestType
    : intent.requestType;
  const comparableBooks = Array.isArray(record.comparableBooks)
    ? record.comparableBooks
        .map((book): { title: string; author?: string } | null => {
          if (!book || typeof book !== "object") return null;
          const item = book as Record<string, unknown>;
          const title = cleanText(item.title);
          const author = cleanText(item.author);
          if (!title) return null;
          return {
            title,
            ...(author ? { author } : {}),
          };
        })
        .filter((book): book is { title: string; author?: string } =>
          Boolean(book),
        )
        .slice(0, 6)
    : [];

  return {
    requestType,
    query: cleanText(record.query) || intent.normalizedQuery || request.query,
    genre: cleanText(record.genre),
    subgenres: cleanList(record.subgenres, 8),
    tone: cleanText(record.tone),
    pacing: cleanText(record.pacing),
    audience: cleanText(record.audience),
    romanceLevel: cleanText(record.romanceLevel),
    darknessLevel: cleanText(record.darknessLevel),
    keyTropes: cleanList(record.keyTropes, 10),
    themes: cleanList(record.themes, 10),
    moods: cleanList(record.moods, 8),
    authors: cleanList(record.authors, 8),
    comparableBooks,
  };
}

function parseCandidateGroups(raw: string): CandidateGroup[] {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== "object") return [];

  const groups = (parsed as Record<string, unknown>).groups;
  if (!Array.isArray(groups)) return [];

  return groups
    .map((group): CandidateGroup | null => {
      if (!group || typeof group !== "object") return null;

      const record = group as Record<string, unknown>;
      const strategy = isRecommendationStrategy(record.strategy)
        ? record.strategy
        : null;
      const books = Array.isArray(record.books) ? record.books : [];

      if (!strategy) return null;

      const candidates = books
        .map((book): AiBookCandidate | null => {
          if (!book || typeof book !== "object") return null;

          const item = book as Record<string, unknown>;
          const title = cleanText(item.title);
          const author = cleanText(item.author);
          const summary = cleanText(item.summary);
          const rationale = cleanText(item.rationale);
          const genres = cleanList(item.genres, 4);
          const moods = cleanList(item.moods, 4);
          const tropes = cleanList(item.tropes, 5);
          const themes = cleanList(item.themes, 5);

          if (!title) return null;

          return {
            title,
            strategy,
            strategyLabel: cleanText(record.label) || strategy.replace(/_/g, " "),
            ...(author ? { author } : {}),
            ...(summary ? { summary } : {}),
            ...(rationale ? { rationale } : {}),
            ...(genres.length > 0 ? { genres } : {}),
            ...(moods.length > 0 ? { moods } : {}),
            ...(tropes.length > 0 ? { tropes } : {}),
            ...(themes.length > 0 ? { themes } : {}),
          };
        })
        .filter((book): book is AiBookCandidate => Boolean(book));

      return {
        strategy,
        label: cleanText(record.label) || strategy.replace(/_/g, " "),
        candidates,
      };
    })
    .filter((group): group is CandidateGroup => Boolean(group))
    .filter((group) => group.candidates.length > 0);
}

export const recommendationAIService = {
  async analyzeRequest(request: RecommendationRequest): Promise<RecommendationIntent> {
    const isHomeSurface = request.surface === "home";
    const cacheKey = `intent:${request.groqModel ?? ""}:${request.surface}:${request.requestTypeHint ?? ""}:${request.query}`;
    const cached = recommendationCacheService.getRequestIntent(cacheKey);
    if (cached) return cached;

    const prompt = `Classify this Loomey recommendation request.

Request: "${request.query}"
Surface: ${request.surface}
Optional request type hint: ${request.requestTypeHint ?? "none"}

Supported request types:
- specific_book: the person wants books like one known book
- author: the person wants books by or like an author
- genre: broad genre
- subgenre: narrower genre/category
- trope: recognizable story trope
- theme: conceptual theme
- mood: feeling or reading mood
- natural_language: any sentence that mixes goals or constraints

Return JSON only with this exact shape:
{
  "requestType": "specific_book|author|genre|subgenre|trope|theme|mood|natural_language",
  "normalizedQuery": "cleaned request",
  "confidence": 0.0,
  "entities": {
    "title": "optional book title",
    "author": "optional author",
    "genre": "optional genre",
    "subgenre": "optional subgenre",
    "trope": "optional trope",
    "theme": "optional theme",
    "mood": "optional mood"
  }
}`;

    const raw = await groqChatJson(
      "You classify book recommendation requests for a reading companion. Return strict JSON only.",
      prompt,
      {
        temperature: ANALYZE_TEMPERATURE,
        maxTokens: isHomeSurface ? HOME_ANALYZE_MAX_TOKENS : ANALYZE_MAX_TOKENS,
        ...(request.groqModel ? { model: request.groqModel } : {}),
      },
    );
    const intent = parseIntent(raw, request);

    recommendationCacheService.setRequestIntent(cacheKey, intent);
    return intent;
  },

  async analyzeSeedBook(input: {
    request: RecommendationRequest;
    intent: RecommendationIntent;
    seedBook: SeedBook | null;
  }): Promise<RecommendationProfile> {
    const isHomeSurface = input.request.surface === "home";
    const cacheKey = `profile:${input.request.groqModel ?? ""}:${input.request.surface}:${input.intent.requestType}:${input.intent.normalizedQuery}:${input.seedBook?.title ?? ""}:${input.seedBook?.author ?? ""}`;
    const cached = recommendationCacheService.getRequestProfile(cacheKey);
    if (cached) return cached;

    const seedContext = formatSeedContext(
      input.seedBook,
      input.intent.normalizedQuery || input.request.query,
    );
    const prompt = `Build a reusable recommendation profile for Loomey.

${seedContext}

Request intent:
${JSON.stringify(input.intent, null, 2)}

${formatReaderContext(input.request)}

This profile may later power Books Like This, Homepage For You, Discover shelves, browse categories, and similar-book pages. Capture the durable reading qualities, not a one-off route response.

Return JSON only with this exact shape:
{
  "requestType": "${input.intent.requestType}",
  "query": "normalized request",
  "genre": "primary genre",
  "subgenres": ["subgenre"],
  "tone": "overall tone",
  "pacing": "pacing style",
  "audience": "audience category",
  "romanceLevel": "none/low/medium/high",
  "darknessLevel": "light/medium/dark",
  "keyTropes": ["trope"],
  "themes": ["theme"],
  "moods": ["mood"],
  "authors": ["author names only when relevant"],
  "comparableBooks": [{"title":"Book Title","author":"Author Name"}]
}

Do not recommend books in this step.`;

    const raw = await groqChatJson(
      "You analyze books and reading tastes for a recommendation engine. Return strict JSON only.",
      prompt,
      {
        temperature: PROFILE_TEMPERATURE,
        maxTokens: isHomeSurface ? HOME_PROFILE_MAX_TOKENS : PROFILE_MAX_TOKENS,
        ...(input.request.groqModel ? { model: input.request.groqModel } : {}),
      },
    );
    const profile = parseProfile(raw, input.request, input.intent);

    recommendationCacheService.setRequestProfile(cacheKey, profile);
    return profile;
  },

  async generateCandidates(input: {
    request: RecommendationRequest;
    intent: RecommendationIntent;
    profile: RecommendationProfile;
    seedBook: SeedBook | null;
  }): Promise<CandidateGroup[]> {
    const isHomeSurface = input.request.surface === "home";
    const seedContext = formatSeedContext(
      input.seedBook,
      input.intent.normalizedQuery || input.request.query,
    );
    const prompt = `You are Loomey's recommendation candidate generator.

${seedContext}

Recommendation profile:
${formatProfile(input.profile)}

${formatReaderContext(input.request)}

Generate multiple candidate groups. Each group should contain real, verifiable books.

Strategies:
- closest_match: tight similarity to the profile or seed
- reader_safe: accessible, satisfying picks that still match
- hidden_gems: less obvious but real books
- recent_releases: newer books when available
- backlist: older or established books; old books are allowed
- adjacent_reads: nearby reads with one meaningful difference

Rules:
- Do not recommend the seed book itself.
- Do not invent books.
- Do not duplicate titles across groups.
- Stay faithful to the request type.
- For author requests, include books by the author and compatible adjacent authors when useful.
- For genre/subgenre/trope/theme/mood requests, recommend books that strongly express that quality.
- Publication year is not a filter. Include old books when they fit.
- Include concise structured genres, moods, tropes, and themes for each book so the app can save useful metadata.
- Do not copy raw catalog categories. Use reader-facing labels.

Return JSON only:
{
  "groups": [
    {
      "strategy": "closest_match",
      "label": "Closest Match",
      "books": [
        {
          "title":"Book Title",
          "author":"Author Name",
          "rationale":"brief optional reason",
          "genres":["Fantasy"],
          "moods":["Cozy"],
          "tropes":["Found family"],
          "themes":["Belonging"]
        }
      ]
    }
  ]
}

Return ${isHomeSurface ? "4" : "10"} books per strategy where possible.`;

    const raw = await groqChatJson(
      "You generate real book recommendation candidates for catalog verification. Return strict JSON only.",
      prompt,
      {
        temperature: CANDIDATE_TEMPERATURE,
        maxTokens: isHomeSurface ? HOME_CANDIDATE_MAX_TOKENS : CANDIDATE_MAX_TOKENS,
        ...(input.request.groqModel ? { model: input.request.groqModel } : {}),
      },
    );

    return parseCandidateGroups(raw);
  },

  async generateFallbackCandidates(input: {
    request: RecommendationRequest;
    intent: RecommendationIntent;
    profile: RecommendationProfile;
    seedBook: SeedBook | null;
    excludedTitles: string[];
  }): Promise<CandidateGroup[]> {
    const isHomeSurface = input.request.surface === "home";
    const prompt = `Loomey needs a second recommendation candidate pass because too few books survived catalog verification.

Seed/request context:
${formatSeedContext(input.seedBook, input.intent.normalizedQuery || input.request.query)}

Recommendation profile:
${formatProfile(input.profile)}

${formatReaderContext(input.request)}

Already tried or excluded titles:
${input.excludedTitles.slice(0, 80).join("\n") || "none"}

Generate additional real books only. Prefer catalog-friendly titles with clear authors and enough metadata to verify.
Use these strategies only: closest_match, hidden_gems, recent_releases, backlist, adjacent_reads.
Do not include excluded titles. Do not invent books. Do not reject old books.

Return JSON only:
{
  "groups": [
    {
      "strategy": "closest_match",
      "label": "Fallback Closest Match",
      "books": [
        {
          "title":"Book Title",
          "author":"Author Name",
          "rationale":"brief optional reason",
          "genres":["Fantasy"],
          "moods":["Cozy"],
          "tropes":["Found family"],
          "themes":["Belonging"]
        }
      ]
    }
  ]
}

Return up to ${isHomeSurface ? "3" : "8"} books per strategy.`;

    const raw = await groqChatJson(
      "You generate additional real book recommendation candidates for catalog verification. Return strict JSON only.",
      prompt,
      {
        temperature: FALLBACK_TEMPERATURE,
        maxTokens: isHomeSurface ? HOME_FALLBACK_MAX_TOKENS : FALLBACK_MAX_TOKENS,
        ...(input.request.groqModel ? { model: input.request.groqModel } : {}),
      },
    );

    return parseCandidateGroups(raw);
  },
};
