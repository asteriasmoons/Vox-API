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

function assertRequiredReflectionStructure(reflection: string): void {
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

  const proseParagraphs = reflection
    .split(/\r?\n\s*\r?\n/)
    .map((section) => section.trim())
    .filter(
      (section) =>
        section &&
        !section
          .split(/\r?\n/)
          .every((line) => line.trim().startsWith("- ")),
    );
  const hasTwoFullParagraphs =
    proseParagraphs.length === 2 &&
    proseParagraphs.every((paragraph) => {
      const sentenceCount = paragraph
        .split(/[.!?]+(?:["')\]]+)?\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean).length;

      return sentenceCount >= 4 && sentenceCount <= 6;
    });

  if (!hasTwoFullParagraphs) {
    throw new Error(
      "Groq returned a journal reflection without exactly two 4-6 sentence paragraphs",
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

  assertRequiredReflectionStructure(reflection);

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

Treat the journal as factual evidence, not a personality test. Distinguish completed actions, current experiences, future plans, and hypothetical possibilities. Never describe a planned action as completed. Do not infer emotions from activities, or causes of emotions unless the author explicitly connects them. Never infer mental traits, motivations, relationship dynamics, coping mechanisms, or lifelong patterns. Keep unrelated subjects separate.

Preserve the user's own framing and emotional scale. Their explicit description or rating of the day is controlling evidence. Do not undermine a positive account by manufacturing tension or a negative counterpoint. An unfinished task, future plan, ordinary preference, practical detail, or moment of affection is not automatically a contradiction or problem. Missing someone is not emotional dependence. "When I feel like it" is not avoidance. Routine preparation is not a coping or control strategy. Identify a problem only when the user explicitly presents it as one.

Write no more than six sentences total across the entire reflection, followed by exactly two questions. Use one or two short paragraphs as appropriate; never pad the response to reach a sentence count. This is ANALYSIS, not a recap: choose one or two meaningful subjects, examine a specific distinction or practical significance the author did not already spell out, and explain it plainly. Do not walk through the day, list activities, paraphrase events, restate feelings, or inflate simple facts into personality traits. Do not force an insight: when a detail has no supported deeper meaning, leave it alone. Before writing each sentence ask: Is this already in the journal? Is this speculation about the person? If either answer is yes, replace it with a grounded observation or choose a different detail. A positive day needs no invented negative angle. A task list is not evidence of memory problems; a stubborn pet is not negotiation; completing a routine is not a psychological transformation; a sign-off is not evidence of relational needs. Do not treat plans as completed actions. Use everyday, warm, clear language directly to the author; no therapy vocabulary, grand metaphors, judgments, advice, praise, or clinical assessments. Never assign people roles not established by the journal.

End with exactly two specific bullet questions, each beginning "- " and ending "?". Do not force confrontation or problem-solving. Challenge only an issue the user explicitly treats as an issue. Otherwise ask about concrete things they enjoyed, appreciated, accomplished, noticed, chose, or anticipate. Questions must be calm, curious, nonjudgmental, and specific to this writing.

Return only valid JSON with exactly these fields:
{"themes":["2-4 literal neutral topics"],"mood":"1-3 proportional words","reflection":"Up to six sentences of analysis total, in one or two paragraphs.\\n\\n- Specific question?\\n- Specific question?"}

Themes must use literal topic framing. Do not relabel pet care as caregiving, affection as dependence, paperwork as instability, or preference as avoidance unless the user does.`;
}

function buildCompactUserPrompt(entryText: string): string {
  return `Analyze, do not summarize, the journal below. Write up to six sentences total of grounded, non-repetitive reflection, followed by exactly two questions. Add understanding beyond what the author already knows happened. Preserve the author's framing, invent no problems or motives, and return only the required JSON.\n\n${entryText}`;
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
