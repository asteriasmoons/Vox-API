import { regularSecondaryGroqChatJson } from "./regularRecs/regularRecsProviders";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const READING_MISSION_MODEL = "openai/gpt-oss-120b";
const READING_MISSION_TIMEOUT_MS = 60_000;

interface GroqChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export interface ReadingMissionBookInput {
  title: string;
  author: string;
  synopsis?: string;
  genres?: string[];
  tags?: string[];
  pageCount?: number;
  seriesName?: string;
  seriesNumber?: string;
}

export interface ReadingMissionTaskOutput {
  title: string;
  description: string;
  category: string;
  difficulty: string;
}

export interface ReadingMissionOutput {
  missions: ReadingMissionTaskOutput[];
}

export interface ReadingMissionScorePromptInput {
  title: string;
  description: string;
  category: string;
  difficulty: string;
  answer: string;
}

export interface ReadingMissionScoreInput {
  book: ReadingMissionBookInput;
  prompts: ReadingMissionScorePromptInput[];
}

export interface ReadingMissionPromptScoreOutput {
  title: string;
  score: number;
  feedback: string;
}

export interface ReadingMissionScoreOutput {
  overallScore: number;
  ratingLabel: string;
  summary: string;
  strengths: string[];
  nextStep: string;
  promptScores: ReadingMissionPromptScoreOutput[];
}

const allowedCategories = [
  "Reflection",
  "Prediction",
  "Observation",
  "Character Analysis",
  "Theme Exploration",
  "Symbolism",
  "Quotes",
  "Creativity",
  "Discussion",
  "Emotional Reflection",
  "Worldbuilding",
  "Curiosity",
];

export async function generateReadingMissions(
  book: ReadingMissionBookInput,
): Promise<ReadingMissionOutput> {
  const apiKey = process.env.GROQ_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  const prompt = buildReadingMissionPrompt(book);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READING_MISSION_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: READING_MISSION_MODEL,
        temperature: 0.72,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You create premium, spoiler-free reading missions for a reading app. Return only valid JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`Groq reading mission request timed out after ${READING_MISSION_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("[reading-missions] Groq error body:", text);
    throw new Error(`Groq reading mission error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as GroqChatResponse;
  const raw = String(json?.choices?.[0]?.message?.content || "").trim();
  const parsed = parseMissionJSON(raw);
  const missions = normalizeMissions(parsed);

  if (missions.length !== 4) {
    throw new Error("Groq returned an invalid reading mission count");
  }

  return { missions };
}

export async function scoreReadingMission(
  input: ReadingMissionScoreInput,
): Promise<ReadingMissionScoreOutput> {
  const prompts = normalizeScorePrompts(input.prompts);
  if (prompts.length !== 4) {
    throw new Error("Exactly four completed mission answers are required.");
  }

  const systemPrompt = [
    "You score personalized reading mission answers for a premium reading app.",
    "You are fair, encouraging, and specific. Reward genuine engagement, book-specific thinking, clear reflection, and evidence that the reader answered the actual prompt.",
    "Do not require spoilers, do not invent book facts, and do not punish a reader for avoiding spoilers.",
    "Return only valid JSON.",
  ].join(" ");

  const userPrompt = buildReadingMissionScorePrompt({
    book: input.book,
    prompts,
  });

  const raw = await regularSecondaryGroqChatJson(systemPrompt, userPrompt, {
    temperature: 0.22,
    maxTokens: 8000,
  });

  return normalizeMissionScore(parseMissionJSON(raw), prompts);
}

function buildReadingMissionPrompt(book: ReadingMissionBookInput): string {
  const synopsis = cleanText(book.synopsis) || "No synopsis provided.";
  const genres = cleanArray(book.genres).join(", ") || "None provided";
  const tags = cleanArray(book.tags).join(", ") || "None provided";
  const pageCount = Number.isFinite(book.pageCount) && Number(book.pageCount) > 0 ? String(book.pageCount) : "Unknown";
  const seriesInfo = cleanText(book.seriesName)
    ? `${cleanText(book.seriesName)}${cleanText(book.seriesNumber) ? ` #${cleanText(book.seriesNumber)}` : ""}`
    : "Standalone or not provided";

  return `You are creating a personalized reading experience for a premium reading app.

Analyze the provided book before generating missions.

Book:
- Title: ${cleanText(book.title)}
- Author: ${cleanText(book.author)}
- Synopsis / Description: ${synopsis}
- Genres: ${genres}
- Tags: ${tags}
- Page Count: ${pageCount}
- Series Information: ${seriesInfo}

Generate four unique reading missions specifically for this book.

Rules:
- Avoid spoilers.
- Every mission must encourage a different type of engagement.
- Make the missions specific to this book's premise, genre, tone, setup, or likely reading experience.
- Do not write generic missions that could apply to any book.
- Keep each description practical enough that the reader can answer it in the app, then mark it complete after writing that answer.
- Use four different categories from this list: ${allowedCategories.join(", ")}.
- Difficulty must be one of: Easy, Medium, Hard.

Return valid JSON in this exact shape:
{
  "missions": [
    {
      "title": "short mission title",
      "description": "2-3 sentences, spoiler-free, specific to the selected book",
      "category": "one allowed category",
      "difficulty": "Easy | Medium | Hard"
    }
  ]
	}`;
}

function buildReadingMissionScorePrompt(input: ReadingMissionScoreInput): string {
  const book = input.book;
  const synopsis = cleanText(book.synopsis) || "No synopsis provided.";
  const genres = cleanArray(book.genres).join(", ") || "None provided";
  const tags = cleanArray(book.tags).join(", ") || "None provided";
  const pageCount = Number.isFinite(book.pageCount) && Number(book.pageCount) > 0 ? String(book.pageCount) : "Unknown";
  const seriesInfo = cleanText(book.seriesName)
    ? `${cleanText(book.seriesName)}${cleanText(book.seriesNumber) ? ` #${cleanText(book.seriesNumber)}` : ""}`
    : "Standalone or not provided";

  const promptBlocks = input.prompts
    .map((prompt, index) => {
      return `Prompt ${index + 1}:
- Category: ${cleanText(prompt.category)}
- Difficulty: ${cleanText(prompt.difficulty)}
- Title: ${cleanText(prompt.title)}
- Prompt: ${cleanText(prompt.description)}
- User Answer: ${cleanText(prompt.answer)}`;
    })
    .join("\n\n");

  return `Score the user's reading mission answers.

Book Context:
- Title: ${cleanText(book.title)}
- Author: ${cleanText(book.author)}
- Synopsis / Description: ${synopsis}
- Genres: ${genres}
- Tags: ${tags}
- Page Count: ${pageCount}
- Series Information: ${seriesInfo}

Mission Prompts and User Answers:
${promptBlocks}

Scoring rules:
- Score each prompt from 0 to 100.
- Score the whole mission from 0 to 100.
- A strong answer directly addresses the prompt, shows specific engagement with the selected book or reading experience, and includes thoughtful detail.
- A thin answer can pass only if it is clearly relevant, but it should score lower.
- Empty, evasive, unrelated, copied prompt text, or nonsense answers must score very low.
- Keep feedback concise, kind, and useful.
- Do not include spoilers.

Return valid JSON in this exact shape:
{
  "overallScore": 0,
  "ratingLabel": "short label",
  "summary": "1-2 sentence score summary",
  "strengths": ["short strength", "short strength"],
  "nextStep": "one concrete next step",
  "promptScores": [
    {
      "title": "matching prompt title",
      "score": 0,
      "feedback": "one sentence"
    }
  ]
}`;
}

function parseMissionJSON(raw: string): unknown {
  if (!raw) {
    throw new Error("Groq returned an empty reading mission response");
  }

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Failed to parse reading mission JSON: ${raw}`);
    }
    return JSON.parse(match[0]);
  }
}

function normalizeMissions(parsed: unknown): ReadingMissionTaskOutput[] {
  const record = isRecord(parsed) ? parsed : {};
  const rawMissions = Array.isArray(record.missions) ? record.missions : [];

  return rawMissions
    .map((item): ReadingMissionTaskOutput | null => {
      if (!isRecord(item)) return null;

      const title = cleanText(item.title);
      const description = cleanText(item.description);
      const category = normalizeCategory(cleanText(item.category));
      const difficulty = normalizeDifficulty(cleanText(item.difficulty));

      if (!title || !description || !category || !difficulty) {
        return null;
      }

      return {
        title,
        description,
        category,
        difficulty,
      };
    })
    .filter((item): item is ReadingMissionTaskOutput => item !== null)
    .slice(0, 4);
}

function normalizeScorePrompts(value: unknown): ReadingMissionScorePromptInput[] {
  return Array.isArray(value)
    ? value
        .map((item): ReadingMissionScorePromptInput | null => {
          if (!isRecord(item)) return null;

          const title = cleanText(item.title);
          const description = cleanText(item.description);
          const category = cleanText(item.category);
          const difficulty = cleanText(item.difficulty);
          const answer = cleanLongText(item.answer);

          if (!title || !description || !category || !difficulty || !answer) {
            return null;
          }

          return {
            title,
            description,
            category,
            difficulty,
            answer,
          };
        })
        .filter((item): item is ReadingMissionScorePromptInput => item !== null)
        .slice(0, 4)
    : [];
}

function normalizeMissionScore(
  parsed: unknown,
  prompts: ReadingMissionScorePromptInput[],
): ReadingMissionScoreOutput {
  const record = isRecord(parsed) ? parsed : {};
  const promptScoresRaw = Array.isArray(record.promptScores) ? record.promptScores : [];
  const promptScores = prompts.map((prompt, index) => {
    const raw = isRecord(promptScoresRaw[index]) ? promptScoresRaw[index] : {};
    return {
      title: cleanText(raw.title) || prompt.title,
      score: clampScore(raw.score),
      feedback: cleanLongText(raw.feedback) || "Answer scored for relevance, detail, and engagement.",
    };
  });

  return {
    overallScore: clampScore(record.overallScore),
    ratingLabel: cleanText(record.ratingLabel).slice(0, 36) || ratingLabelForScore(clampScore(record.overallScore)),
    summary: cleanLongText(record.summary) || "Mission answers scored for relevance, detail, and book-specific engagement.",
    strengths: cleanArray(record.strengths).slice(0, 3),
    nextStep: cleanLongText(record.nextStep) || "Add one more specific detail from your reading experience next time.",
    promptScores,
  };
}

function normalizeCategory(value: string): string {
  const match = allowedCategories.find(
    (category) =>
      category.toLowerCase() === value.toLowerCase() ||
      category.replace(/\s+/g, "").toLowerCase() === value.replace(/\s+/g, "").toLowerCase(),
  );

  return match || "";
}

function normalizeDifficulty(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === "easy") return "Easy";
  if (normalized === "medium") return "Medium";
  if (normalized === "hard") return "Hard";
  return "";
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanLongText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[ \t]+/g, " ").slice(0, 2200) : "";
}

function cleanArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanText).filter((item) => item.length > 0).slice(0, 18)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampScore(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function ratingLabelForScore(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 78) return "Strong";
  if (score >= 65) return "Solid";
  if (score >= 45) return "Developing";
  return "Needs Depth";
}
