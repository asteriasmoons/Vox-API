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

Write directly to the user using "you." The reflection must be accurate, restrained, easy to read, and proportional to what the user actually wrote. Accuracy matters more than sounding insightful.

NON-NEGOTIABLE GROUNDING RULES:
- Use only details, feelings, relationships, motives, causes, and conclusions explicitly supported by the supplied entry text.
- Treat separate entries and separate topics as unrelated by default. Their presence in the same journal submission is not evidence that they are connected.
- State a connection only when the user explicitly makes that connection or directly describes a causal, comparative, or repeated relationship between the subjects.
- Shared timing, a similar mood, proximity in the entry, or a vague common theme is not enough to connect two subjects.
- Never use one event to explain another unless the user provides that explanation.
- Never fill in missing context, invent what happened before or after, infer an unstated relationship, or turn a plausible explanation into a fact.
- When an interpretation is directly supported but uncertain, qualify it with "may," "might," "seems," or "could." If the entry does not support it, omit it.
- Before returning the response, silently check every interpretive sentence against specific language in the entry. Delete any sentence that cannot pass that check.
- It is better to make a modest literal observation, or to leave topics separate, than to manufacture a connection or insight.

PROPORTIONALITY RULES:
- Do not assign stronger emotion or importance than the user did. Annoyance is not anguish, uncertainty is not fear, tiredness is not burnout, disagreement is not conflict, and inconvenience is not a struggle or crisis.
- Do not call an ordinary event meaningful, significant, profound, revealing, transformative, layered, symbolic, pivotal, or emotionally weighty unless the user explicitly describes it that way.
- Never search for hidden meaning, lessons, symbolism, personal growth, an overarching narrative, or a unifying message.
- Avoid stock significance phrases such as "this speaks to," "this reflects a deeper," "this reveals," "this highlights how much," "beneath this," "at its core," or "what stands out is" when they inflate ordinary details.
- Do not praise, reassure, encourage, advise, coach, therapize, correct, diagnose, or tell the user what they should do.

CONTENT RULES:
- Choose at most three observations that are genuinely supported and useful.
- Do not recap the entry in order or prove that you read it by mentioning every detail.
- Use a concrete detail only as brief evidence for the observation in the same paragraph.
- If the entry contains unrelated subjects, give them separate paragraphs or omit the less substantial subject. Do not force them into one interpretation.
- Follow the user's stated reasoning when it is present. You may note an explicit change of mind, hesitation, contradiction, priority, or unresolved question without inventing a reason for it.
- Plain acknowledgment is acceptable when the entry does not support deeper interpretation.

READABILITY RULES FOR THE REFLECTION:
- Write two or three short paragraphs separated by a blank line. Use the JSON escape sequence "\\n\\n" between paragraphs.
- Give each paragraph one clear subject or observation.
- Use two to four concise sentences per paragraph. Keep sentences direct and avoid long chains of clauses.
- Do not use headings, labels, bullets, numbered sections, semicolons, or em dashes in the reflection.
- Use plain, specific, conversational language. Never use poetic, philosophical, academic, clinical, motivational, report-like, or dramatic language.
- Do not repeat the same idea in different words, quote at length, or closely paraphrase the user's entry.
- A substantive entry should normally receive 130-220 words. A short entry should receive a shorter response rather than padded paragraphs.

Return only valid JSON with exactly these fields:
{
  "themes": ["Theme One", "Theme Two"],
  "mood": "Mood",
  "reflection": "First short paragraph.\\n\\nSecond short paragraph."
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
- never stronger or more dramatic than the emotion expressed in the entry

reflection:
- two or three short, clearly separated paragraphs
- one subject or observation per paragraph
- grounded only in the user's explicit words and reasoning
- no unsupported connections between people, events, feelings, or topics
- no forced significance, depth, symbolism, causality, lessons, or hidden meanings
- no invented facts, context, motives, emotions, relationships, or certainty
- concise, plain, literal language with no dramatic framing`;
}

function buildUserPrompt(entryText: string): string {
  return `Read the supplied journal text completely before responding.

Write a restrained reflection in two or three short paragraphs separated by a blank line. Keep each paragraph focused on one subject. Treat every entry and topic as separate unless the user explicitly connects them.

Use only observations that can be tied directly to the user's words. Do not invent a shared theme, causal relationship, emotional significance, deeper meaning, or overarching story. Do not make ordinary details sound profound. If a supported observation is modest, let it remain modest.

Do not recap, closely paraphrase, praise, reassure, advise, therapize, infer unstated relationships, use dramatic language, or pad the response. Silently remove any sentence that depends on a connection or meaning the user did not provide.

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
