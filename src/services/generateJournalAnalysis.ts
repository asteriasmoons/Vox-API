import { groqChatJson, groqChatText } from "./groqAIClient";

const MODEL = "openai/gpt-oss-120b";
const FREE_TIER_TPM_LIMIT = 8_000;
const FREE_TIER_HEADROOM_TOKENS = 700;
const MAX_OUTPUT_TOKENS = 1_600;
const MIN_OUTPUT_TOKENS = 700;
const MAX_ENTRY_TEXT_CHARS = 18_000;

export interface JournalAnalysisResult {
  themes: string[];
  mood: string;
  reflection: string;
}

interface EntryInput {
  title: string;
  body: string;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const content = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!content) return null;

  try {
    const parsed = JSON.parse(content);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[0]);

      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function estimatedTokenCount(value: string): number {
  return Math.ceil(value.length / 4);
}

function truncateForFreeTier(value: string): string {
  if (value.length <= MAX_ENTRY_TEXT_CHARS) return value;

  return `${value.slice(0, MAX_ENTRY_TEXT_CHARS).trim()}\n\n[Entry shortened to fit Groq Free Plan token limits.]`;
}

function freeTierOutputBudget(systemPrompt: string, userPrompt: string): number {
  const estimatedPromptTokens =
    estimatedTokenCount(systemPrompt) + estimatedTokenCount(userPrompt) + 250;
  const available =
    FREE_TIER_TPM_LIMIT -
    FREE_TIER_HEADROOM_TOKENS -
    estimatedPromptTokens;

  return Math.max(
    MIN_OUTPUT_TOKENS,
    Math.min(MAX_OUTPUT_TOKENS, available),
  );
}

function assertRequiredReflectionQuestions(reflection: string): void {
  const contentLines = reflection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletQuestions = contentLines.filter((line) => line.startsWith("- "));
  const finalLines = contentLines.slice(-2);
  const hasTwoFinalQuestions =
    bulletQuestions.length === 2 &&
    finalLines.length === 2 &&
    finalLines.every((line) => line.startsWith("- ") && /\?$/.test(line));

  if (!hasTwoFinalQuestions) {
    throw new Error(
      "Groq returned a journal reflection without exactly two final bullet questions",
    );
  }
}

function journalAnalysisFromParsed(
  parsed: Record<string, unknown>,
): JournalAnalysisResult {
  const themes = Array.isArray(parsed.themes)
    ? parsed.themes.map((t: unknown) => String(t).trim()).filter(Boolean)
    : [];

  const mood = String(parsed.mood || "").trim();
  const reflection = String(parsed.reflection || "").trim();

  console.log(
    "[analyze] themes:",
    themes,
    "mood:",
    mood,
    "reflection length:",
    reflection.length,
  );

  if (!mood || !reflection || themes.length === 0) {
    throw new Error("Groq returned incomplete analysis fields");
  }

  assertRequiredReflectionQuestions(reflection);

  return {
    themes: themes.slice(0, 4),
    mood,
    reflection,
  };
}

function buildEntryText(entries: EntryInput[]): string {
  const entryText = entries
    .map((entry) => `Entry: "${entry.title}"\n${entry.body.trim()}`)
    .join("\n\n---\n\n");

  return truncateForFreeTier(entryText);
}


function buildCompactSystemPrompt(): string {
  return `Write a grounded daily journal reflection for Lunixia. You are not a therapist, evaluator, problem-finder, or advice giver.

Use only the supplied writing. Do not claim knowledge of the user's broader life, personality, history, habits, relationships, motives, values, or recurring patterns. Keep unrelated topics separate. Never invent causality, hidden meaning, psychological mechanisms, or connections.

Preserve the user's own framing and emotional scale. Their explicit description or rating of the day is controlling evidence. Do not undermine a positive account by manufacturing tension or a negative counterpoint. An unfinished task, future plan, ordinary preference, practical detail, or moment of affection is not automatically a contradiction or problem. Missing someone is not emotional dependence. "When I feel like it" is not avoidance. Routine preparation is not a coping or control strategy. Identify a problem only when the user explicitly presents it as one.

Write one to three short paragraphs with one supported observation each. Offer faithful, specific synthesis rather than recap, novelty, or psychological interpretation. Do not repeat the entry, cover every topic, inflate ordinary details, or use filler. Do not praise, reassure, advise, diagnose, moralize, scold, judge, sound snippy, or tell the user what they really feel or need to admit. Never ask them to cope with, fix, manage, or make a plan for something they did not identify as a problem.

End with exactly two specific bullet questions, each beginning "- " and ending "?". Do not force confrontation or problem-solving. Challenge only an issue the user explicitly treats as an issue. Otherwise ask about concrete things they enjoyed, appreciated, accomplished, noticed, chose, or anticipate. Questions must be calm, curious, nonjudgmental, and specific to this writing.

Return only valid JSON with exactly these fields:
{"themes":["2-4 literal neutral topics"],"mood":"1-3 proportional words","reflection":"Paragraph text.\\n\\n- Specific question?\\n- Specific question?"}

Themes must use literal topic framing. Do not relabel pet care as caregiving, affection as dependence, paperwork as instability, or preference as avoidance unless the user does.`;
}

function buildCompactUserPrompt(entryText: string): string {
  return `Reflect only on the journal text below. Preserve its explicit framing, do not invent a problem, and return only the required JSON.\n\n${entryText}`;
}

function isProviderJsonValidationFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Failed to validate JSON")
  );
}

export async function generateJournalAnalysis(
  entries: EntryInput[],
): Promise<JournalAnalysisResult> {
  const entryText = buildEntryText(entries);
  const systemPrompt = buildCompactSystemPrompt();
  const userPrompt = buildCompactUserPrompt(entryText);
  const maxTokens = freeTierOutputBudget(systemPrompt, userPrompt);

  console.log("[analyze] Sending request to Groq...", {
    model: MODEL,
    maxTokens,
    estimatedPromptTokens:
      estimatedTokenCount(systemPrompt) + estimatedTokenCount(userPrompt) + 250,
  });

  let raw: string;

  try {
    raw = await groqChatJson(systemPrompt, userPrompt, {
      stage: "journal-analysis",
      model: MODEL,
      temperature: 0.05,
      maxTokens,
    });
  } catch (error) {
    if (!isProviderJsonValidationFailure(error)) throw error;

    console.warn(
      "[analyze] Groq JSON validation failed; retrying once without constrained decoding",
    );
    raw = await groqChatText(systemPrompt, userPrompt, {
      stage: "journal-analysis-json-fallback",
      model: MODEL,
      temperature: 0.05,
      maxTokens,
    });
  }

  const parsed = parseJsonObject(raw);

  if (!parsed) {
    console.error("[analyze] JSON parse error: unable to extract JSON object");

    throw new Error(`Failed to parse Groq JSON response: ${raw}`);
  }

  console.log("[analyze] Parsed:", JSON.stringify(parsed));

  return journalAnalysisFromParsed(parsed);
}
