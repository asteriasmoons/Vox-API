import { groqChatJson } from "./groqAIClient";

const DAILY_INTENTION_MODEL = "openai/gpt-oss-120b";

export interface DailyIntentionRequest {
  context: string;
}

export interface DailyIntentionResponse {
  intention: string;
}

type DailyIntentionParsedResponse = {
  intention?: unknown;
};

const SYSTEM_PROMPT = `You write short daily intentions for a wellness app called Lunixia.

Turn the user's context into one grounded first-person daily intention.

Rules:
- Write one to two sentences.
- Use present tense.
- Start with "I".
- Do not use future-tense or setup phrases such as "I intent to", "I intend to", "I will", "I'm going to", "I want to", or "I need to".
- Write the intention as if the desired state or action is already happening now.
- Do not give advice, explanation, title, quotes, bullets, or prefixes.
- Keep it natural, calm, and specific to the user's context.

Return only valid JSON with exactly this shape:
{
  "intention": "I ..."
}`;

function parseIntention(raw: string): string {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error(`Daily intention response did not contain JSON: ${raw}`);
  }

  const parsed = JSON.parse(match[0]) as DailyIntentionParsedResponse;
  return typeof parsed.intention === "string" ? parsed.intention.trim() : "";
}

function cleanIntention(raw: string): string {
  let value = raw
    .trim()
    .replace(/^["'\u2018\u2019\u201c\u201d\s]+|["'\u2018\u2019\u201c\u201d\s]+$/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .find(Boolean) ?? "";

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

  const raw = await groqChatJson(
    SYSTEM_PROMPT,
    `Context:\n${context}`,
    {
      stage: "daily-intention",
      temperature: 0.25,
      maxTokens: 1200,
      model: DAILY_INTENTION_MODEL,
    },
  );

  const intention = cleanIntention(parseIntention(raw));

  if (!intention) {
    throw new Error("Groq returned an empty daily intention");
  }

  return { intention };
}
