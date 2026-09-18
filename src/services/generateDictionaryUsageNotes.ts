// Usage Notes AI for the dictionary lookup feature.
// Given a word plus concise dictionary context, returns up to 2 Label/Value
// usage notes compatible with Markly's existing Usage Notes (label/value) model.
//
// The prompt is intentionally short (Groq free plan) and contains exactly two
// illustrative Label/Value examples so the model understands the intended
// semantics. Edit the prompt below to tune behavior.

import { groqChatJson } from "./groqAIClient";
import { NormalizedUsageNote } from "./dictionaryShared";

const MODEL = "openai/gpt-oss-120b";
const FREE_TIER_TPM_LIMIT = 8_000;
const FREE_TIER_HEADROOM_TOKENS = 700;
const MAX_OUTPUT_TOKENS = 700;
const MIN_OUTPUT_TOKENS = 300;
const MAX_USAGE_NOTES = 2;

export interface UsageNotesContext {
  word: string;
  partOfSpeech?: string;
  definitions?: string[];
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
  return `You write concise dictionary "usage notes" for a personal words dictionary app.

A usage note is a short Label/Value pair describing HOW a word is used: its register, tone, connotation, formality, typical context, or common restriction. It is NOT a definition, synonym, or example sentence.

Return only valid JSON in exactly this shape:
{ "usageNotes": [ { "label": "Register", "value": "..." } ] }

Rules:
- Return at most ${MAX_USAGE_NOTES} usage notes. Fewer is fine.
- Label: 1-2 words naming the aspect (e.g. Formal, Slang, Technical, Appreciative).
- Value: one clear sentence describing the usage. No definitions, no example sentences.
- Base notes only on the supplied word and context. Do not invent facts. If nothing useful can be said, return an empty array.

Two examples of the intended Label/Value relationship:
{ "label": "Formal", "value": "Commonly used as a more formal or literary term for a person with a strong love of books or an enthusiasm for collecting them." }
{ "label": "Appreciative", "value": "Usually carries a positive tone, suggesting genuine affection for books and often an appreciation of their physical, artistic, or collectible qualities." }`;
}

function buildUserPrompt(context: UsageNotesContext): string {
  const definitions = (context.definitions ?? [])
    .slice(0, 3)
    .map((d, i) => `${i + 1}. ${d}`)
    .join("\n");

  const lines = [`Word: ${context.word}`];
  if (context.partOfSpeech) lines.push(`Part of speech: ${context.partOfSpeech}`);
  if (definitions) lines.push(`Definitions:\n${definitions}`);

  return `${lines.join("\n")}

Write up to ${MAX_USAGE_NOTES} usage notes for this word as JSON.`;
}

function usageNotesFromParsed(parsed: Record<string, unknown>): NormalizedUsageNote[] {
  const raw = Array.isArray(parsed.usageNotes) ? parsed.usageNotes : [];
  const notes: NormalizedUsageNote[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const label = String(record.label ?? "").replace(/\s+/g, " ").trim();
    const value = String(record.value ?? "").replace(/\s+/g, " ").trim();
    if (!label || !value) continue;
    notes.push({ label, value });
    if (notes.length >= MAX_USAGE_NOTES) break;
  }

  return notes;
}

export async function generateDictionaryUsageNotes(
  context: UsageNotesContext,
): Promise<NormalizedUsageNote[]> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(context);
  const maxTokens = outputBudget(systemPrompt, userPrompt);

  try {
    const raw = await groqChatJson(systemPrompt, userPrompt, {
      stage: "dictionary-usage-notes",
      model: MODEL,
      temperature: 0.3,
      maxTokens,
    });

    const parsed = parseJsonObject(raw);
    if (!parsed) return [];
    return usageNotesFromParsed(parsed);
  } catch (error) {
    // AI enrichment is best-effort; a failure here must not fail the lookup.
    console.error("[vox:dictionary] usage notes generation failed", {
      word: context.word,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
