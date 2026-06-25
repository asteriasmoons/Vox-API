const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_CHALLENGE_MODEL || "llama-3.1-8b-instant";

export type LumeyChallengeValidationStatus =
  | "approved"
  | "needsMoreInfo"
  | "rejected";

export interface LumeyThemeValidationBook {
  title: string;
  author?: string;
  summary?: string;
  genres?: string[];
  moods?: string[];
  tags?: string[];
  tropes?: string[];
  topics?: string[];
}

export interface LumeyThemeValidationInput {
  challengeTitle: string;
  requirementText: string;
  requiredThemes: string[];
  books: LumeyThemeValidationBook[];
  submissionNote?: string;
  reviewText?: string;
}

export interface LumeyThemeValidationResult {
  result: LumeyChallengeValidationStatus;
  message: string;
}

export async function validateLumeyChallengeTheme(
  input: LumeyThemeValidationInput,
): Promise<LumeyThemeValidationResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const safeInput = sanitizeInput(input);

  const body = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 350,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are Lumey's challenge validation assistant.

Your job is to decide whether a user's linked books, metadata, review text, and submission note satisfy a reading challenge's fuzzy or theme-based requirement.

You ONLY validate vibe/theme/interpretation-based reading challenges.

Valid response statuses:
- approved
- needsMoreInfo
- rejected

Return a JSON object with exactly these keys:
- "result": "approved" | "needsMoreInfo" | "rejected"
- "message": A short friendly explanation.

Rules:
- Be fair, not overly strict.
- If the books clearly match the theme, approve.
- If the user gave too little context but the submission might qualify, return needsMoreInfo.
- If the books clearly do not match the theme, reject.
- Do not approve if the submitted information is empty or unrelated.
- Do not mention being an AI.
- Keep the message kind, clear, and user-facing.
- The message should be 1-2 sentences.
- Do not include markdown, code fences, extra keys, or explanations outside the JSON object.`,
      },
      {
        role: "user",
        content: JSON.stringify(safeInput, null, 2),
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let resp: Response;

  try {
    resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);

    if (err?.name === "AbortError") {
      throw new Error("Groq request timed out after 60s");
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("[lumey-challenge-theme] Groq error body:", text);
    throw new Error(`Groq error ${resp.status}: ${text}`);
  }

  const json: any = await resp.json();
  const raw = String(json?.choices?.[0]?.message?.content || "").trim();

  let parsed: any;

  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("[lumey-challenge-theme] JSON parse error:", e);
    throw new Error(`Failed to parse Groq JSON response: ${raw}`);
  }

  const result = normalizeResult(parsed.result);
  const message = String(parsed.message || "").trim();

  if (!message) {
    throw new Error("Groq returned empty validation message");
  }

  return {
    result,
    message: message.slice(0, 280),
  };
}

function sanitizeInput(
  input: LumeyThemeValidationInput,
): LumeyThemeValidationInput {
  return {
    challengeTitle: cleanString(input.challengeTitle, 160),
    requirementText: cleanString(input.requirementText, 300),
    requiredThemes: cleanStringArray(input.requiredThemes, 30, 80),
    books: Array.isArray(input.books)
      ? input.books.map(cleanBook).filter((book) => book.title.length > 0)
      : [],
    submissionNote: cleanString(input.submissionNote ?? "", 1200),
    reviewText: cleanString(input.reviewText ?? "", 2000),
  };
}

function cleanBook(book: LumeyThemeValidationBook): LumeyThemeValidationBook {
  return {
    title: cleanString(book.title, 180),
    author: cleanString(book.author ?? "", 120),
    summary: cleanString(book.summary ?? "", 1200),
    genres: cleanStringArray(book.genres, 20, 60),
    moods: cleanStringArray(book.moods, 20, 60),
    tags: cleanStringArray(book.tags, 30, 60),
    tropes: cleanStringArray(book.tropes, 30, 60),
    topics: cleanStringArray(book.topics, 30, 60),
  };
}

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
}

function cleanStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxItemLength))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

function normalizeResult(value: unknown): LumeyChallengeValidationStatus {
  if (value === "approved") return "approved";
  if (value === "rejected") return "rejected";
  return "needsMoreInfo";
}
