// Example Sentences AI for the dictionary lookup feature.
// Given a word plus concise dictionary context, returns up to 3 natural example
// sentences compatible with Markly's existing Example Sentences (string array).
//
// The prompt is intentionally short (Groq free plan). Edit the prompt below to
// tune behavior.

import { groqChatJson } from "./groqAIClient";

const MODEL = "openai/gpt-oss-120b";
const FREE_TIER_TPM_LIMIT = 8_000;
const FREE_TIER_HEADROOM_TOKENS = 700;
const MAX_OUTPUT_TOKENS = 700;
const MIN_OUTPUT_TOKENS = 300;
const MAX_SENTENCES = 3;

export interface ExampleSentencesContext {
  word: string;
  partOfSpeech?: string;
  definitions?: string[];
  existingExamples?: string[];
}

function estimatedTokenCount(value: string): number {
  return Math.ceil(value.length / 4);
}

function outputBudget(systemPrompt: string, userPrompt: string): number {
  const promptTokens =
    estimatedTokenCount(systemPrompt) + estimatedTokenCount(userPrompt) + 200;
  const available = FREE_TIER_TPM_LIMIT - FREE_TIER_HEADROOM_TOKENS - promptTokens;
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(MAX_OUTPUT_TOKENS, available));
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
    const candidate = match?.[0];
    if (!candidate) return null;
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function buildSystemPrompt(): string {
  return `You write natural example sentences for a personal word dictionary app.

Return only valid JSON in exactly this shape:
{ "exampleSentences": ["...", "..."] }

Rules:
- Return at most ${MAX_SENTENCES} sentences. Fewer is fine.
- Each sentence must use the given word correctly for its part of speech and meaning.
- Show realistic, everyday usage in context. Do NOT restate or paraphrase the definition.
- Vary the sentences. Keep each to a single natural sentence.
- Do not invent facts about the word; rely on the supplied context.`;
}

function buildUserPrompt(context: ExampleSentencesContext): string {
  const definitions = (context.definitions ?? [])
    .slice(0, 3)
    .map((d, i) => `${i + 1}. ${d}`)
    .join("\n");

  const lines = [`Word: ${context.word}`];
  if (context.partOfSpeech) lines.push(`Part of speech: ${context.partOfSpeech}`);
  if (definitions) lines.push(`Definitions:\n${definitions}`);

  return `${lines.join("\n")}

Write up to ${MAX_SENTENCES} example sentences using "${context.word}" as JSON.`;
}

function sentencesFromParsed(parsed: Record<string, unknown>): string[] {
  const raw = Array.isArray(parsed.exampleSentences)
    ? parsed.exampleSentences
    : [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const sentence = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!sentence) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sentence);
    if (out.length >= MAX_SENTENCES) break;
  }

  return out;
}

export async function generateDictionaryExampleSentences(
  context: ExampleSentencesContext,
): Promise<string[]> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(context);
  const maxTokens = outputBudget(systemPrompt, userPrompt);

  try {
    const raw = await groqChatJson(systemPrompt, userPrompt, {
      stage: "dictionary-example-sentences",
      model: MODEL,
      temperature: 0.4,
      maxTokens,
    });

    const parsed = parseJsonObject(raw);
    if (!parsed) return [];
    return sentencesFromParsed(parsed);
  } catch (error) {
    // AI enrichment is best-effort; a failure here must not fail the lookup.
    console.error("[vox:dictionary] example sentences generation failed", {
      word: context.word,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
