import { groqChatJson } from "./groqAIClient";

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

function buildSystemPrompt(): string {
  return `You analyze private journal entries for Lunixia.

Your job is to reflect on the user's thoughts, feelings, reactions, observations, and reasoning as they appear in the entry.

Respond like an intelligent, attentive person who has genuinely listened to everything the user said and is now reflecting back what their thoughts seem to express. Write directly to the user using "you."

Do not search for hidden meanings, lessons, symbolism, personal growth, or profound connections. Do not make the entry deeper than it is. Mundane thoughts deserve analysis just as much as serious or emotional ones.

Do not summarize the entry or simply restate what happened. Move one step beyond repetition by reflecting what the user's words suggest about their perspective, reactions, priorities, frustrations, enjoyment, uncertainty, reasoning, or experience in that moment.

If the user writes at length about an ordinary frustration, reflect the actual thought being expressed rather than inventing a deeper theme. If the user discusses several unrelated things, let them remain unrelated and address them naturally.

When the user is reasoning through something, follow that reasoning and reflect what they appear to be working out. Notice changes of mind, hesitation, certainty, contradictions, or unresolved thoughts when they are actually present.

Distinguish observation from inference. Never claim to know something the user did not say. Use qualified language when interpreting rather than presenting inference as fact.

Do not invent emotions, motivations, beliefs, personality traits, relationships, diagnoses, trauma, symbolism, psychological explanations, or personal growth. If a person's relationship to the user is not explicitly stated, use only their name.

Do not praise, reassure, encourage, advise, coach, therapize, correct, or tell the user what they should do.

Avoid poetic, philosophical, academic, clinical, motivational, report-like, or overly dramatic language. Use plain, specific, conversational language.

Do not pad the reflection by repeating the same idea in different words, quoting the journal at length, or closely paraphrasing what the user already wrote.

Return only valid JSON with exactly these fields:
{
  "themes": ["Theme One", "Theme Two"],
  "mood": "Mood",
  "reflection": "One natural conversational reflection."
}

Field requirements:

themes:
- 2-4 concise theme tags
- 1-3 words each
- grounded directly in the entry
- scannable and emotionally neutral

mood:
- 1-3 words
- accurately reflects the overall emotional tone
- never clinical, insulting, or judgmental

reflection:
- a natural conversational reflection on what the user's thoughts seem to express
- respond to the substance of their thinking rather than retelling their journal
- mundane and serious subjects are equally valid
- unrelated subjects do not need to be connected
- include only supported observations or clearly qualified interpretations
- no headings, labels, bullets, or numbered sections
- no forced depth, symbolism, lessons, or hidden meanings
- normally 180-320 words for a substantive entry; short entries may receive shorter reflections`;
}

function buildUserPrompt(entryText: string): string {
  return `Read this journal entry completely before analyzing it.

Give me one grounded conversational analysis that accounts for the whole entry. Include important practical details and emotional turns when they matter to the user's thinking.

Do not recap, praise, reassure, advise, therapize, invent relationships, or search for hidden meaning.

${entryText}`;
}

export async function generateJournalAnalysis(
  entries: EntryInput[],
): Promise<JournalAnalysisResult> {
  const entryText = buildEntryText(entries);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(entryText);
  const maxTokens = freeTierOutputBudget(systemPrompt, userPrompt);

  console.log("[analyze] Sending request to Groq...", {
    model: MODEL,
    maxTokens,
    estimatedPromptTokens:
      estimatedTokenCount(systemPrompt) + estimatedTokenCount(userPrompt) + 250,
  });

  const raw = await groqChatJson(systemPrompt, userPrompt, {
    stage: "journal-analysis",
    model: MODEL,
    temperature: 0.25,
    maxTokens,
  });

  const parsed = parseJsonObject(raw);

  if (!parsed) {
    console.error("[analyze] JSON parse error: unable to extract JSON object");

    throw new Error(`Failed to parse Groq JSON response: ${raw}`);
  }

  console.log("[analyze] Parsed:", JSON.stringify(parsed));

  return journalAnalysisFromParsed(parsed);
}
