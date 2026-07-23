import { recommendationCacheService } from "./recommendationCacheService";
import { recommendationGroqModel } from "./groqModelConfig";
import { mistralChatText } from "./mistralAIClient";
import { openRouterChatJson } from "./openRouterAIClient";
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
const CANDIDATE_MAX_TOKENS = 6200;
const HOME_CANDIDATE_MAX_TOKENS = 1400;
const FALLBACK_MAX_TOKENS = 3800;
const HOME_FALLBACK_MAX_TOKENS = 1100;
const GROQ_TIMEOUT_MS = 45_000;
const GROQ_RETRIES = 2;
const GROQ_CANDIDATE_SCHEMA_RETRIES = 1;
const FINAL_GROQ_SHELF_MAX_TOKENS = 2400;
const FINAL_GROQ_STRATEGY_MAX_TOKENS = 1800;
const FINAL_GROQ_SOURCE_MAX_CHARS = 4500;
const PRIMARY_CANDIDATE_STRATEGIES: RecommendationStrategy[] = [
  "closest_match",
  "reader_safe",
  "hidden_gems",
  "recent_releases",
  "backlist",
  "adjacent_reads",
];
const FALLBACK_CANDIDATE_STRATEGIES: RecommendationStrategy[] = [
  "closest_match",
  "hidden_gems",
  "recent_releases",
  "backlist",
  "adjacent_reads",
];
const SHELF_CANDIDATE_COUNT = 40;

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
};

type GroqOptions = {
  stage: string;
  temperature: number;
  maxTokens: number;
  model?: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function logProviderOutput(
  provider: "groq" | "mistral" | "openrouter",
  stage: string,
  output: string,
): void {
  console.log(`[recommendations:${provider}] full output`, {
    stage,
    outputLength: output.length,
    output,
  });
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
  const content = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
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

function parseJsonObjectOrArray(raw: string): unknown | null {
  const content = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // Try an array below.
      }
    }

    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return null;

    try {
      return JSON.parse(arrayMatch[0]);
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
      ? `Favorite genres: ${context.favoriteGenres.slice(0, 5).join(", ")}`
      : "",
    context.favoriteAuthors?.length
      ? `Favorite authors: ${context.favoriteAuthors.slice(0, 5).join(", ")}`
      : "",
    context.favoriteTropes?.length
      ? `Favorite tropes: ${context.favoriteTropes.slice(0, 5).join(", ")}`
      : "",
    context.favoriteMoods?.length
      ? `Favorite moods: ${context.favoriteMoods.slice(0, 5).join(", ")}`
      : "",
    context.favoriteTags?.length
      ? `Favorite tags: ${context.favoriteTags.slice(0, 6).join(", ")}`
      : "",
    context.ratings?.length
      ? `Rated books: ${context.ratings
          .slice(0, 10)
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

function compactBookSignal(book: {
  title: string;
  author?: string;
  rating?: number;
  genres?: string[];
  moods?: string[];
  tropes?: string[];
  tags?: string[];
  seriesName?: string;
}) {
  return {
    title: book.title,
    ...(book.author ? { author: book.author } : {}),
    ...(book.rating !== undefined ? { rating: book.rating } : {}),
    ...(book.genres?.length ? { genres: cleanList(book.genres, 4) } : {}),
    ...(book.moods?.length ? { moods: cleanList(book.moods, 4) } : {}),
    ...(book.tropes?.length ? { tropes: cleanList(book.tropes, 4) } : {}),
    ...(book.tags?.length ? { tags: cleanList(book.tags, 5) } : {}),
    ...(book.seriesName ? { seriesName: book.seriesName } : {}),
  };
}

function topSignals(values: string[], limit: number): string[] {
  return cleanList(values, limit);
}

function compactTastePayload(input: {
  request: RecommendationRequest;
  intent: RecommendationIntent;
  profile: RecommendationProfile;
  seedBook: SeedBook | null;
  candidateCount: string;
}) {
  const context = input.request.readerContext;
  const highestRatedBooks =
    context?.highestRatedBooks?.length
      ? context.highestRatedBooks.slice(0, 15).map(compactBookSignal)
      : (context?.ratings ?? [])
          .filter((book) => book.rating >= 4)
          .sort((a, b) => b.rating - a.rating)
          .slice(0, 15)
          .map((book) => ({
            title: book.title,
            ...(book.author ? { author: book.author } : {}),
            rating: book.rating,
          }));
  const lowestRatedBooks = (context?.ratings ?? [])
    .filter((book) => book.rating > 0 && book.rating <= 2.5)
    .sort((a, b) => a.rating - b.rating)
    .slice(0, 5)
    .map((book) => ({
      title: book.title,
      ...(book.author ? { author: book.author } : {}),
      rating: book.rating,
    }));
  const recentlyEnjoyedGenres = topSignals(
    highestRatedBooks.flatMap((book) =>
      "genres" in book && Array.isArray(book.genres) ? book.genres : [],
    ),
    5,
  );
  const recentlyEnjoyedMoods = topSignals(
    highestRatedBooks.flatMap((book) =>
      "moods" in book && Array.isArray(book.moods) ? book.moods : [],
    ),
    5,
  );

  return {
    tasteProfile: {
      favoriteGenres: topSignals(context?.favoriteGenres ?? [], 5),
      favoriteSubgenres: topSignals(context?.favoriteSubgenres ?? [], 5),
      favoriteTropes: topSignals(context?.favoriteTropes ?? [], 5),
      favoriteMoods: topSignals(context?.favoriteMoods ?? [], 5),
      favoriteThemes: topSignals(context?.favoriteThemes ?? [], 5),
      favoriteAuthors: topSignals(context?.favoriteAuthors ?? [], 5),
      favoriteTags: topSignals(context?.favoriteTags ?? [], 6),
    },
    ratingSignals: {
      highestRatedBooks,
      lowestRatedBooks,
    },
    readingPreferences: {
      ...(context?.pagePreferences
        ? { pagePreferences: context.pagePreferences }
        : {}),
      recentlyEnjoyedGenres:
        recentlyEnjoyedGenres.length > 0
          ? recentlyEnjoyedGenres
          : topSignals(context?.favoriteGenres ?? [], 5),
      recentlyEnjoyedMoods:
        recentlyEnjoyedMoods.length > 0
          ? recentlyEnjoyedMoods
          : topSignals(context?.favoriteMoods ?? [], 5),
    },
    request: {
      query: input.request.query,
      requestType: input.intent.requestType,
      candidateCount: Number(input.candidateCount),
    },
    groqAnalysis: {
      requestAnalysis: {
        requestType: input.intent.requestType,
        normalizedQuery: input.intent.normalizedQuery,
        confidence: input.intent.confidence,
        entities: input.intent.entities,
      },
      recommendationProfile: {
        requestType: input.profile.requestType,
        query: input.profile.query,
        subgenres: input.profile.subgenres,
        tone: input.profile.tone,
        pacing: input.profile.pacing,
        romanceLevel: input.profile.romanceLevel,
        darknessLevel: input.profile.darknessLevel,
        keyTropes: input.profile.keyTropes,
        moods: input.profile.moods,
        authors: input.profile.authors,
        comparableBooks: input.profile.comparableBooks,
      },
      seedBook: input.seedBook
        ? {
            title: input.seedBook.title,
            author: input.seedBook.author,
            subjects: input.seedBook.subjects.slice(0, 8),
            releaseYear: input.seedBook.releaseYear,
            source: input.seedBook.source,
          }
        : null,
    },
  };
}

function formatCandidateHandoff(input: {
  request: RecommendationRequest;
  intent: RecommendationIntent;
  profile: RecommendationProfile;
  seedBook: SeedBook | null;
  candidateCount: string;
}): string {
  return [
    "Compact AI candidate input:",
    JSON.stringify(
      compactTastePayload(input),
      null,
      2,
    ),
    "",
    "Owned, finished, current, dismissed, and already recommended books are filtered by backend code after candidate generation. They are intentionally not included in this AI payload.",
  ].join("\n");
}

function candidateCountForSurface(request: RecommendationRequest): string {
  if (request.surface === "home") return "4";
  if (request.surface === "shelf") return String(SHELF_CANDIDATE_COUNT);
  return "10";
}

function fallbackCountForSurface(request: RecommendationRequest): string {
  if (request.surface === "home") return "3";
  if (request.surface === "shelf") return String(SHELF_CANDIDATE_COUNT);
  return "8";
}

function primaryStrategiesForSurface(
  request: RecommendationRequest,
): RecommendationStrategy[] {
  if (request.surface === "shelf") return ["closest_match"];
  return PRIMARY_CANDIDATE_STRATEGIES;
}

function fallbackStrategiesForSurface(
  request: RecommendationRequest,
): RecommendationStrategy[] {
  if (request.surface === "shelf") return ["closest_match"];
  return FALLBACK_CANDIDATE_STRATEGIES;
}

function strategyLabel(strategy: RecommendationStrategy): string {
  switch (strategy) {
    case "closest_match":
      return "Closest Match";
    case "reader_safe":
      return "Reader Safe";
    case "hidden_gems":
      return "Hidden Gems";
    case "recent_releases":
      return "Recent Releases";
    case "backlist":
      return "Backlist";
    case "adjacent_reads":
      return "Adjacent Reads";
  }
}

function strategyInstruction(strategy: RecommendationStrategy): string {
  switch (strategy) {
    case "closest_match":
      return "Generate tight similarity picks that closely match the profile or seed.";
    case "reader_safe":
      return "Generate accessible, satisfying picks that still match the profile.";
    case "hidden_gems":
      return "Generate less obvious but real books with strong fit.";
    case "recent_releases":
      return "Generate newer books when available, without inventing publication facts.";
    case "backlist":
      return "Generate older or established books; old books are allowed when they fit.";
    case "adjacent_reads":
      return "Generate nearby reads with one meaningful difference from the core profile.";
  }
}

function candidateSchemaRetryInstruction(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return [
    "",
    "Critical formatting correction:",
    `The previous candidate-generation response could not be parsed: ${message}.`,
    "Return one complete JSON object only.",
    "Do not use markdown, code fences, comments, explanations, or trailing prose.",
    "Do not truncate the JSON.",
    "The top-level object must be exactly shaped like {\"strategy\":\"closest_match\",\"label\":\"Closest Match\",\"books\":[...]} with valid arrays.",
    "Every book must include non-empty string title and author fields.",
  ].join("\n");
}

function numericCandidateLimit(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 50));
}

function compactCandidateSourceForRepair(input: {
  raw: string;
  strategy: RecommendationStrategy;
  label: string;
  maxBooks: number;
}): string {
  const raw = input.raw.trim();
  if (!raw) return "";

  try {
    const group = parseCandidateGroup(raw, input.strategy, input.label);
    return JSON.stringify(
      {
        strategy: input.strategy,
        label: input.label,
        books: group.candidates.slice(0, input.maxBooks).map((candidate) => ({
          title: candidate.title,
          author: candidate.author ?? "",
          ...(candidate.genres?.length ? { genres: candidate.genres.slice(0, 4) } : {}),
          ...(candidate.moods?.length ? { moods: candidate.moods.slice(0, 4) } : {}),
          ...(candidate.tropes?.length ? { tropes: candidate.tropes.slice(0, 4) } : {}),
        })),
      },
      null,
      2,
    );
  } catch {
    return raw.slice(0, FINAL_GROQ_SOURCE_MAX_CHARS);
  }
}

function shouldContinueAfterOpenRouterError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (/timed out after/i.test(error.message)) return true;

  const statusMatch = error.message.match(/HTTP\s+(\d+)/i);
  if (!statusMatch?.[1]) return false;

  const status = Number(statusMatch[1]);
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function generateMistralCandidateDraft(input: {
  stage: string;
  systemPrompt: string;
  userPrompt: string;
  strategy: RecommendationStrategy;
  label: string;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const draft = await mistralChatText(input.systemPrompt, input.userPrompt, {
    stage: `${input.stage}:mistral-draft`,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
  });
  logProviderOutput("mistral", `${input.stage}:mistral-draft`, draft);

  console.log("[recommendations:mistral] drafted candidates", {
    stage: input.stage,
    strategy: input.strategy,
    draftLength: draft.length,
  });

  return draft;
}

async function finalizeCandidateGroupWithGroq(input: {
  stage: string;
  systemPrompt: string;
  candidateInput: string;
  openRouterRaw: string;
  mistralDraft: string;
  strategy: RecommendationStrategy;
  label: string;
  booksPerStrategy: string;
  isFullShelfRequest?: boolean;
  temperature: number;
  maxTokens: number;
}): Promise<CandidateGroup> {
  const requestedCount = numericCandidateLimit(
    input.booksPerStrategy,
    input.isFullShelfRequest ? 40 : 10,
  );
  const maxRepairBooks = input.isFullShelfRequest
    ? Math.min(requestedCount, 40)
    : requestedCount;
  const openRouterRepairSource = compactCandidateSourceForRepair({
    raw: input.openRouterRaw,
    strategy: input.strategy,
    label: input.label,
    maxBooks: maxRepairBooks,
  });
  const mistralRepairSource = compactCandidateSourceForRepair({
    raw: input.mistralDraft,
    strategy: input.strategy,
    label: input.label,
    maxBooks: maxRepairBooks,
  });
  let prompt = [
    input.candidateInput,
    "",
    `Strategy: ${input.strategy}`,
    `Label: ${input.label}`,
    `Return up to ${maxRepairBooks} books.`,
    "",
    "OpenRouter candidate data to parse first:",
    openRouterRepairSource || "(OpenRouter returned empty content.)",
    "",
    "Mistral draft candidate data if OpenRouter output is missing or malformed:",
    mistralRepairSource || "(Mistral returned empty content.)",
    "",
    "Groq final JSON parser job:",
    "Convert the candidate data above into one complete strict JSON object.",
    "Do not summarize. Do not explain. Do not use markdown.",
    "Preserve real title and author pairs from the supplied candidate data.",
    "If OpenRouter returned empty content, recover the final candidate JSON from the Mistral draft and the supplied constraints.",
    "Do not return rationale or themes.",
    "Return one JSON object only in this exact shape:",
    JSON.stringify(
      {
        strategy: input.strategy,
        label: input.label,
        books: [
          {
            title: "Book Title",
            author: "Author Name",
            genres: ["Fantasy"],
            moods: ["Cozy"],
            tropes: ["Found family"],
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= GROQ_CANDIDATE_SCHEMA_RETRIES; attempt += 1) {
    let raw: string;
    try {
      raw = await groqChatJson(
        "You are the final strict JSON parser for book recommendation candidates. Return JSON only.",
        prompt,
        {
          stage: `${input.stage}:groq-final-parse`,
          temperature: 0.05,
          maxTokens: Math.min(
            input.maxTokens,
            input.isFullShelfRequest
              ? FINAL_GROQ_SHELF_MAX_TOKENS
              : FINAL_GROQ_STRATEGY_MAX_TOKENS,
          ),
        },
      );
    } catch (error) {
      lastError = error;
      const status = groqErrorStatus(error);
      if (status !== 413 && status !== 429) throw error;

      console.error("[recommendations:groq] final parse unavailable", {
        stage: input.stage,
        strategy: input.strategy,
        attempt: attempt + 1,
        status,
        message: error instanceof Error ? error.message : String(error),
      });

      const repairSources = [
        ["openrouter", input.openRouterRaw],
        ["mistral", input.mistralDraft],
      ] as const;
      for (const [source, sourceRaw] of repairSources) {
        try {
          const group = parseCandidateGroup(sourceRaw, input.strategy, input.label);
          console.warn("[recommendations:engine] using provider candidates without final Groq parse", {
            stage: input.stage,
            strategy: input.strategy,
            source,
            candidates: group.candidates.length,
          });
          return group;
        } catch {
          // Try the next provider source.
        }
      }

      break;
    }

    try {
      const group = parseCandidateGroup(raw, input.strategy, input.label);
      console.log("[recommendations:groq] parsed final candidates", {
        stage: input.stage,
        strategy: input.strategy,
        attempt: attempt + 1,
        candidates: group.candidates.length,
      });
      return group;
    } catch (error) {
      lastError = error;
      console.error("[recommendations:groq] final candidate parse failure", {
        stage: input.stage,
        strategy: input.strategy,
        attempt: attempt + 1,
        message: error instanceof Error ? error.message : String(error),
        rawLength: raw.length,
      });

      if (attempt >= GROQ_CANDIDATE_SCHEMA_RETRIES) break;
      prompt = `${prompt}${candidateSchemaRetryInstruction(error)}`;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function finalizeCandidateGroupWithOpenRouterAndGroq(input: {
  stage: string;
  systemPrompt: string;
  userPrompt: string;
  candidateInput: string;
  mistralDraft: string;
  strategy: RecommendationStrategy;
  label: string;
  booksPerStrategy: string;
  isFullShelfRequest?: boolean;
  temperature: number;
  maxTokens: number;
}): Promise<CandidateGroup> {
  let openRouterRaw = "";
  try {
    openRouterRaw = await openRouterChatJson(input.systemPrompt, input.userPrompt, {
      stage: `${input.stage}:openrouter-final-candidates`,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
  } catch (error) {
    if (!shouldContinueAfterOpenRouterError(error)) throw error;

    console.error("[recommendations:openrouter] finalization unavailable", {
      stage: `${input.stage}:openrouter-final-candidates`,
      strategy: input.strategy,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  logProviderOutput(
    "openrouter",
    `${input.stage}:openrouter-final-candidates`,
    openRouterRaw,
  );

  console.log("[recommendations:openrouter] finalized candidate data", {
    stage: input.stage,
    strategy: input.strategy,
    rawLength: openRouterRaw.length,
  });

  return finalizeCandidateGroupWithGroq({
    ...input,
    openRouterRaw,
    systemPrompt:
      "You parse and repair finalized book recommendation candidates into strict JSON for catalog verification. Return JSON only.",
  });
}

async function generateCandidateGroupWithProviders(input: {
  stage: string;
  systemPrompt: string;
  userPrompt: string;
  candidateInput: string;
  strategy: RecommendationStrategy;
  label: string;
  booksPerStrategy: string;
  isFullShelfRequest?: boolean;
  temperature: number;
  maxTokens: number;
}): Promise<CandidateGroup> {
  const draftJob = input.isFullShelfRequest
    ? [
        "Draft real candidate ideas for the full opened collection shelf.",
        "This is the one tapped shelf request, not per-strategy work.",
      ]
    : [
        "Draft real candidate ideas for this one strategy.",
        "This is not the final response.",
      ];
  const draftPrompt = [
    input.userPrompt,
    "",
    "Mistral job:",
    ...draftJob,
    "Do not redo Groq's request analysis. Use Groq's structured profile as authoritative.",
    "Include title, author, summary, genres, moods, and tropes when useful.",
    "Do not return rationale or themes.",
    "If you cannot return clean JSON, return a concise structured list that OpenRouter can convert.",
  ].join("\n");

  const mistralDraft = await generateMistralCandidateDraft({
    ...input,
    systemPrompt: input.isFullShelfRequest
      ? "You draft real book recommendation candidates for one opened collection shelf. This is intermediate work, not the final API response."
      : "You draft real book recommendation candidates for one strategy. This is intermediate work, not the final API response.",
    userPrompt: draftPrompt,
  });

  const finalJsonJob = input.isFullShelfRequest
    ? "Use the Groq profile, constraints, exclusions, and Mistral draft to return final valid JSON for the full opened shelf."
    : "Use the Groq profile, constraints, exclusions, and Mistral draft to return the final valid JSON.";
  const finalPrompt = [
    input.userPrompt,
    "",
    "Mistral draft candidate data:",
    mistralDraft.slice(0, 18_000),
    "",
    "OpenRouter job:",
    "You are the final JSON stage of a sequential recommendation pipeline.",
    "Groq already performed request/profile analysis. Mistral already drafted candidate ideas.",
    finalJsonJob,
    "Ignore any earlier all-groups JSON example in the context.",
    "Do not return rationale or themes.",
    "Do not return markdown, comments, explanations, or prose outside JSON when possible.",
    "If you cannot return valid JSON, return a concise structured list that Groq can convert.",
    "Do not invent placeholders. Return real books only.",
    "Return one complete JSON object only in this exact shape:",
    JSON.stringify(
      {
        strategy: input.strategy,
        label: input.label,
        books: [
          {
            title: "Book Title",
            author: "Author Name",
            summary: "brief optional premise and reading-experience note",
            genres: ["Fantasy"],
            moods: ["Cozy"],
            tropes: ["Found family"],
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");

  return finalizeCandidateGroupWithOpenRouterAndGroq({
    ...input,
    systemPrompt:
      "You finalize book recommendation candidates into one strict JSON object for catalog verification. Return JSON only.",
    userPrompt: finalPrompt,
    mistralDraft,
  });
}

async function generateCandidateGroupsByStrategy(input: {
  stage: string;
  systemPrompt: string;
  userPrompt: string;
  candidateInput: string;
  strategies: RecommendationStrategy[];
  booksPerStrategy: string;
  isFullShelfRequest?: boolean;
  temperature: number;
  maxTokens: number;
}): Promise<CandidateGroup[]> {
  const groups: CandidateGroup[] = [];
  const seenKeys = new Set<string>();

  for (const strategy of input.strategies) {
    const label = strategyLabel(strategy);
    const stageSegment = input.isFullShelfRequest ? "full_shelf" : strategy;
    const strategyPrompt = input.isFullShelfRequest
      ? [
          "Generate the full opened collection shelf in this single request.",
          "This is the only candidate-generation request for the tapped shelf.",
          `Strategy field: ${strategy}`,
          `Label: ${label}`,
          "Use every part of the supplied Groq profile, reader context, and exclusions.",
          `Return up to ${input.booksPerStrategy} books for this shelf.`,
          "Do not return rationale or themes.",
        ]
      : [
          "Generate exactly one candidate group for this strategy only.",
          `Strategy: ${strategy}`,
          `Label: ${label}`,
          `Strategy meaning: ${strategyInstruction(strategy)}`,
          `Return up to ${input.booksPerStrategy} books for this strategy.`,
        ];
    const group = await generateCandidateGroupWithProviders({
      stage: `${input.stage}:${stageSegment}`,
      systemPrompt: input.systemPrompt,
      userPrompt: [
        input.userPrompt,
        "",
        ...strategyPrompt,
        "",
        "Return JSON only in this exact shape:",
        JSON.stringify(
          {
            strategy,
            label,
            books: [
              {
                title: "Book Title",
                author: "Author Name",
                summary: "brief optional premise and reading-experience note",
                genres: ["Fantasy"],
                moods: ["Cozy"],
                tropes: ["Found family"],
              },
            ],
          },
          null,
          2,
        ),
      ].join("\n"),
      strategy,
      label,
      booksPerStrategy: input.booksPerStrategy,
      candidateInput: input.candidateInput,
      ...(input.isFullShelfRequest ? { isFullShelfRequest: true } : {}),
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });

    const candidates = group.candidates.filter((candidate) => {
      const key = `${candidate.title.toLowerCase()}|${candidate.author?.toLowerCase() ?? ""}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    if (candidates.length > 0) {
      groups.push({
        ...group,
        candidates,
      });
    }
  }

  if (groups.length === 0) {
    throw new Error("Candidate final JSON stage returned no usable candidates");
  }

  return groups;
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

function groqErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;

  try {
    const parsed = JSON.parse(error.message) as { status?: unknown };
    return typeof parsed.status === "number" ? parsed.status : null;
  } catch {
    return null;
  }
}

function isRetriableGroqStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
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
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    try {
      const model = options.model ?? recommendationGroqModel();
      console.log("[recommendations:groq] request", {
        stage: options.stage,
        model,
        attempt: attempt + 1,
        promptChars: userPrompt.length,
        maxTokens: options.maxTokens,
      });

      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
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
      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        console.error("[recommendations:groq] failure", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          status: response.status,
        });
        throw new Error(
          JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            body: json,
          }),
        );
      }

      console.log("[recommendations:groq] success", {
        stage: options.stage,
        model,
        attempt: attempt + 1,
        durationMs,
      });

      const content = cleanText(json?.choices?.[0]?.message?.content);
      logProviderOutput("groq", options.stage, content);
      return content;
    } catch (error) {
      lastError = error;
      if (attempt >= GROQ_RETRIES) break;
      const status = groqErrorStatus(error);
      if (status !== null && !isRetriableGroqStatus(status)) break;
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

export function parseCandidateGroups(raw: string): CandidateGroup[] {
  const parsed = parseJsonObjectOrArray(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Candidate final JSON stage returned malformed JSON");
  }

  if (
    !Array.isArray(parsed) &&
    isRecommendationStrategy((parsed as Record<string, unknown>).strategy) &&
    Array.isArray((parsed as Record<string, unknown>).books)
  ) {
    const record = parsed as Record<string, unknown>;
    const strategy = record.strategy as RecommendationStrategy;
    const label = cleanText(record.label) || strategyLabel(strategy);
    const candidates = parseCandidateBooks(record.books, strategy, label);

    if (candidates.length === 0) {
      throw new Error("Candidate final JSON stage returned no usable candidates");
    }

    return [
      {
        strategy,
        label,
        candidates,
      },
    ];
  }

  const groups = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>).groups;
  if (!Array.isArray(groups)) {
    throw new Error("Candidate final JSON stage returned JSON without groups");
  }

  const parsedGroups = groups
    .map((group): CandidateGroup | null => {
      if (!group || typeof group !== "object") return null;

      const record = group as Record<string, unknown>;
      const strategy = isRecommendationStrategy(record.strategy)
        ? record.strategy
        : null;
      const books = Array.isArray(record.books) ? record.books : [];

      if (!strategy) return null;
      const label = cleanText(record.label) || strategyLabel(strategy);
      const candidates = parseCandidateBooks(books, strategy, label);

      return {
        strategy,
        label,
        candidates,
      };
    })
    .filter((group): group is CandidateGroup => Boolean(group))
    .filter((group) => group.candidates.length > 0);

  if (parsedGroups.length === 0) {
    throw new Error("Candidate final JSON stage returned no usable candidates");
  }

  return parsedGroups;
}

function parseCandidateGroup(
  raw: string,
  expectedStrategy: RecommendationStrategy,
  expectedLabel: string,
): CandidateGroup {
  const groups = parseCandidateGroups(raw);
  const matchingGroup =
    groups.find((group) => group.strategy === expectedStrategy) ?? groups[0];

  if (!matchingGroup) {
    throw new Error("Candidate final JSON stage returned no usable candidates");
  }

  return {
    strategy: expectedStrategy,
    label: matchingGroup.label || expectedLabel,
    candidates: matchingGroup.candidates.map((candidate) => ({
      ...candidate,
      strategy: expectedStrategy,
      strategyLabel: candidate.strategyLabel || expectedLabel,
    })),
  };
}

function parseCandidateBooks(
  books: unknown,
  strategy: RecommendationStrategy,
  label: string,
): AiBookCandidate[] {
  if (!Array.isArray(books)) return [];

  return books
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

      if (!title || !author) return null;

      return {
        title,
        author,
        strategy,
        strategyLabel: label,
        ...(summary ? { summary } : {}),
        ...(rationale ? { rationale } : {}),
        ...(genres.length > 0 ? { genres } : {}),
        ...(moods.length > 0 ? { moods } : {}),
        ...(tropes.length > 0 ? { tropes } : {}),
        ...(themes.length > 0 ? { themes } : {}),
      };
    })
    .filter((book): book is AiBookCandidate => Boolean(book));
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
        stage: "request-analysis",
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
  "subgenres": ["subgenre"],
  "tone": "overall tone",
  "pacing": "pacing style",
  "romanceLevel": "none/low/medium/high",
  "darknessLevel": "light/medium/dark",
  "keyTropes": ["trope"],
  "moods": ["mood"],
  "authors": ["author names only when relevant"],
  "comparableBooks": [{"title":"Book Title","author":"Author Name"}]
}

Do not recommend books in this step.`;

    let raw: string;
    try {
      raw = await groqChatJson(
        "You analyze books and reading tastes for a recommendation engine. Return strict JSON only.",
        prompt,
        {
          stage: "seed-profile-analysis",
          temperature: PROFILE_TEMPERATURE,
          maxTokens: isHomeSurface ? HOME_PROFILE_MAX_TOKENS : PROFILE_MAX_TOKENS,
          ...(input.request.groqModel ? { model: input.request.groqModel } : {}),
        },
      );
    } catch (error) {
      const status = groqErrorStatus(error);
      if (input.request.surface !== "shelf" || (status !== 413 && status !== 429)) {
        throw error;
      }

      const profile = fallbackProfile(input.request, input.intent);
      console.warn("[recommendations:groq] seed profile unavailable; using intent profile for shelf", {
        surface: input.request.surface,
        requestType: input.intent.requestType,
        status,
        queryLength: input.request.query.length,
      });
      recommendationCacheService.setRequestProfile(cacheKey, profile);
      return profile;
    }

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
    const candidateCount = candidateCountForSurface(input.request);
    const candidateInput = formatCandidateHandoff({ ...input, candidateCount });
    const prompt = `You are the candidate-generation stage of a sequential Loomey book recommendation pipeline.

Groq has already interpreted the request. The backend has built a compact taste profile from the reader's data.
Use only the compact candidate input below. Do not ask for, infer, or require the reader's full library.

${candidateInput}

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
- For genre/subgenre/trope/mood requests, recommend books that strongly express that quality.
- Publication year is not a filter. Include old books when they fit.
- Include concise structured genres, moods, and tropes for each book so the app can save useful metadata.
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
          "summary":"brief optional premise and reading-experience note",
          "genres":["Fantasy"],
          "moods":["Cozy"],
          "tropes":["Found family"]
        }
      ]
    }
  ]
}

Return ${candidateCount} books per strategy where possible.`;

    return generateCandidateGroupsByStrategy({
      stage: "primary-candidate-generation",
      systemPrompt:
        "You generate one strategy group of real book recommendation candidates for catalog verification. Return one complete valid JSON object only.",
      userPrompt: prompt,
      candidateInput,
      strategies: primaryStrategiesForSurface(input.request),
      booksPerStrategy: candidateCount,
      isFullShelfRequest: input.request.surface === "shelf",
      temperature: CANDIDATE_TEMPERATURE,
      maxTokens:
        input.request.surface === "home"
          ? HOME_CANDIDATE_MAX_TOKENS
          : CANDIDATE_MAX_TOKENS,
    });
  },

  async generateFallbackCandidates(input: {
    request: RecommendationRequest;
    intent: RecommendationIntent;
    profile: RecommendationProfile;
    seedBook: SeedBook | null;
    excludedTitles: string[];
  }): Promise<CandidateGroup[]> {
    const candidateCount = fallbackCountForSurface(input.request);
    const candidateInput = formatCandidateHandoff({ ...input, candidateCount });
    const prompt = `Loomey needs a second recommendation candidate pass because too few books survived catalog verification.

Use only this compact taste payload:
${candidateInput}

Generate additional real books only. Prefer catalog-friendly titles with clear authors and enough metadata to verify.
Use these strategies only: closest_match, hidden_gems, recent_releases, backlist, adjacent_reads.
Do not invent books. Do not reject old books.
Do not return rationale or themes.

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
          "summary":"brief optional premise and reading-experience note",
          "genres":["Fantasy"],
          "moods":["Cozy"],
          "tropes":["Found family"]
        }
      ]
    }
  ]
}

Return up to ${candidateCount} books per strategy.`;

    return generateCandidateGroupsByStrategy({
      stage: "fallback-candidate-generation",
      systemPrompt:
        "You generate one strategy group of additional real book recommendation candidates for catalog verification. Return one complete valid JSON object only.",
      userPrompt: prompt,
      candidateInput,
      strategies: fallbackStrategiesForSurface(input.request),
      booksPerStrategy: candidateCount,
      isFullShelfRequest: input.request.surface === "shelf",
      temperature: FALLBACK_TEMPERATURE,
      maxTokens:
        input.request.surface === "home"
          ? HOME_FALLBACK_MAX_TOKENS
          : FALLBACK_MAX_TOKENS,
    });
  },
};
