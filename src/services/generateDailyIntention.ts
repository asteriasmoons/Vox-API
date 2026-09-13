import { groqChatText } from "./groqAIClient";

const DAILY_INTENTION_MODEL = "openai/gpt-oss-120b";

export interface DailyIntentionRequest {
  context: string;
}

export interface DailyIntentionResponse {
  intention: string;
}

const SYSTEM_PROMPT = `You write short daily intentions for a wellness app called Lunixia.

Turn the user's context into one grounded first-person daily intention.

Rules:
- Write exactly one sentence.
- Use present tense.
- Start with "I".
- Do not write "I intend to", "I will", "I'm going to", "I want to", or "I need to".
- Do not give advice, explanation, title, quotes, bullets, or prefixes.
- Keep it natural, calm, and specific to the user's context.
- Keep it under 24 words.`;

function cleanIntention(raw: string): string {
  let value = raw
    .trim()
    .replace(/^["'\u2018\u2019\u201c\u201d\s]+|["'\u2018\u2019\u201c\u201d\s]+$/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .find(Boolean) ?? "";

  const replacements: Array<[RegExp, string]> = [
    [/^i\s+intend\s+to\s+/i, "I "],
    [/^i\s+will\s+/i, "I "],
    [/^i(?:'|\u2019)?m\s+going\s+to\s+/i, "I "],
    [/^i\s+am\s+going\s+to\s+/i, "I "],
    [/^i\s+want\s+to\s+/i, "I "],
    [/^i\s+need\s+to\s+/i, "I "],
    [/^my\s+intention\s+is\s+to\s+/i, "I "],
  ];

  for (const [pattern, replacement] of replacements) {
    value = value.replace(pattern, replacement);
  }

  value = value.trim();
  if (!value) return "";

  value = value.charAt(0).toUpperCase() + value.slice(1);
  if (!/[.!?]$/.test(value)) value += ".";

  return value;
}

export async function generateDailyIntention(
  input: DailyIntentionRequest,
): Promise<DailyIntentionResponse> {
  const context = input.context.trim();

  if (!context) {
    throw new Error("Context is required");
  }

  const raw = await groqChatText(
    SYSTEM_PROMPT,
    `Context:\n${context}`,
    {
      stage: "daily-intention",
      temperature: 0.45,
      maxTokens: 80,
      model: DAILY_INTENTION_MODEL,
    },
  );

  const intention = cleanIntention(raw);

  if (!intention) {
    throw new Error("Groq returned an empty daily intention");
  }

  return { intention };
}
