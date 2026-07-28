//
//  regularRecsConfig.ts
//  Tunable configuration for the REGULAR recommendation engine.
//

export const REGULAR_GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";
export const REGULAR_GOOGLE_BOOKS_SEARCH_URL =
  "https://www.googleapis.com/books/v1/volumes";
export const REGULAR_OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";

export const REGULAR_GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export const REGULAR_TARGET_FINAL_RECOMMENDATION_COUNT = 30;
export const REGULAR_MIN_ACCEPTABLE_RECOMMENDATION_COUNT = 12;

export const REGULAR_CANDIDATES_PER_GROUP = 26; // 20-35 band
export const REGULAR_MAX_REQUEST_TEXT_LENGTH = 200;

export const REGULAR_CATALOG_CONCURRENCY = 8;
export const REGULAR_GROQ_TIMEOUT_MS = 45_000;
export const REGULAR_CATALOG_TIMEOUT_MS = 12_000;
export const REGULAR_MAX_HTTP_RETRIES = 3;

export const REGULAR_GROQ_TEMPERATURE_ANALYZE = 0.2;
export const REGULAR_GROQ_TEMPERATURE_RECOMMEND = 0.35;
export const REGULAR_GROQ_MAX_TOKENS_ANALYZE = 700;
export const REGULAR_GROQ_MAX_TOKENS_RECOMMEND = 2200;

// Cache TTLs (ms)
export const REGULAR_TTL_SEED = 12 * 60 * 60 * 1000;
export const REGULAR_TTL_PROFILE = 12 * 60 * 60 * 1000;
export const REGULAR_TTL_CATALOG = 24 * 60 * 60 * 1000;
export const REGULAR_TTL_FINAL = 3 * 60 * 60 * 1000;

// Suspicious catalog keywords (derivative / non-original works).
export const REGULAR_SUSPICIOUS_KEYWORDS = [
  "summary",
  "study guide",
  "workbook",
  "analysis of",
  "companion",
  "unofficial",
  "journal",
  "notebook",
  "boxed set",
  "box set",
  "sparknotes",
  "cliffsnotes",
  "quiz",
  "trivia",
  "coloring book",
];
