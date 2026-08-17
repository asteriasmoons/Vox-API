const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "mood_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        mindset: { type: "string" },
        emotionalBalance: { type: "string" },
        influences: { type: "string" },
        reflection: { type: "string" },
        themes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "mindset",
        "emotionalBalance",
        "influences",
        "reflection",
        "themes",
      ],
      additionalProperties: false,
    },
  },
};

export interface MoodAnalysisInput {
  emotions: { name: string; category: "positive" | "neutral" | "negative" }[];
  activities: string[];
  sleepHours: number;
  exerciseMinutes: number;
  steps: number;
  meditationMinutes: number;
  waterOz: number;
  note: string;
  timestamp: string; // ISO date string
}

export interface MoodAnalysisResult {
  mindset: string;
  emotionalBalance: string;
  influences: string;
  reflection: string;
  themes: string[];
}

interface GroqRequestBody {
  model: string;
  temperature: number;
  max_tokens: number;
  response_format?: unknown;
  messages: { role: "system" | "user"; content: string }[];
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

function isJsonValidationFailure(status: number, body: string): boolean {
  return status === 400 && body.includes("json_validate_failed");
}

async function postGroq(
  apiKey: string,
  body: GroqRequestBody,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Groq request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function moodAnalysisFromParsed(parsed: Record<string, unknown>): MoodAnalysisResult {
  return {
    mindset: String(parsed.mindset || "").trim(),
    emotionalBalance: String(parsed.emotionalBalance || "").trim(),
    influences: String(parsed.influences || "").trim(),
    reflection: String(parsed.reflection || "").trim(),
    themes: Array.isArray(parsed.themes)
      ? parsed.themes.map((t: any) => String(t).trim()).filter(Boolean)
      : [],
  };
}

export async function analyzeMood(
  input: MoodAnalysisInput,
): Promise<MoodAnalysisResult> {
  const apiKey = process.env.GROQ_API_KEY_ALT;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY_ALT");

  // Build structured context
  const positiveEmotions = input.emotions
    .filter((e) => e.category === "positive")
    .map((e) => e.name);
  const neutralEmotions = input.emotions
    .filter((e) => e.category === "neutral")
    .map((e) => e.name);
  const negativeEmotions = input.emotions
    .filter((e) => e.category === "negative")
    .map((e) => e.name);

  const date = new Date(input.timestamp);
  const hour = date.getHours();
  const timeOfDay =
    hour < 6
      ? "late night"
      : hour < 12
        ? "morning"
        : hour < 17
          ? "afternoon"
          : hour < 21
            ? "evening"
            : "night";

  let lifestyleLines: string[] = [];
  if (input.sleepHours > 0)
    lifestyleLines.push(`Sleep: ${input.sleepHours} hours`);
  if (input.exerciseMinutes > 0)
    lifestyleLines.push(`Exercise: ${input.exerciseMinutes} minutes`);
  if (input.steps > 0) lifestyleLines.push(`Steps: ${input.steps}`);
  if (input.meditationMinutes > 0)
    lifestyleLines.push(`Mindfulness: ${input.meditationMinutes} minutes`);
  if (input.waterOz > 0) lifestyleLines.push(`Water: ${input.waterOz} oz`);

  const userContent = `Mood log recorded in the ${timeOfDay} on ${date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}:

Positive emotions (${positiveEmotions.length}): ${positiveEmotions.join(", ") || "none"}
Neutral emotions (${neutralEmotions.length}): ${neutralEmotions.join(", ") || "none"}
Negative emotions (${negativeEmotions.length}): ${negativeEmotions.join(", ") || "none"}

Activities: ${input.activities.length > 0 ? input.activities.join(", ") : "none selected"}

Lifestyle data:
${lifestyleLines.length > 0 ? lifestyleLines.join("\n") : "No lifestyle data recorded"}

${input.note ? `User note: "${input.note}"` : "No note provided"}`;

  const body: GroqRequestBody = {
    model: MODEL,
    temperature: 0.25,
    max_tokens: 3000,
    response_format: RESPONSE_FORMAT,
    messages: [
      {
        role: "system",
        content: `You are a mood insight analyzer for a wellness app called Lunixia. You receive a mood log containing selected emotions (categorized as positive, neutral, or negative), selected activities, lifestyle data (sleep, exercise, steps, mindfulness, water), an optional note, and the time of day.

Your job is to produce a grounded, thoughtful reflection of the person's current emotional state. You are not a therapist. You are not diagnosing anything. You are simply helping someone see their own mood more clearly.

Return a JSON object with exactly these keys:

"mindset" — A short phrase (2-5 words) capturing the overall feel. Examples: "Reflective and optimistic", "Quietly energized", "Processing a heavy day"

"emotionalBalance" — 2-3 sentences describing how the selected emotions sit together. Consider ALL of them proportionally. If someone picked 10 positive emotions and 1 negative one, the negative one is part of the picture — it does not define it. Mixed emotions are normal and should be described that way.

"influences" — 2-3 sentences about what may be shaping the mood, drawn from the activities, lifestyle data, note, and time of day. Use language like "may," "appears," "could," "seems." These are possible connections, not conclusions.

"reflection" — 3-5 sentences offering a warm, grounded overall insight. Speak directly using "you" — never say "the user." Write like a thoughtful friend who gets it, not like a clinical report. Acknowledge complexity. If frustration exists alongside motivation, say that. If calm sits next to uncertainty, say that. Do not flatten someone's emotional range into a single takeaway.

"themes" — An array of 2-5 short theme words in Title Case derived from the activities and emotional patterns. Examples: "Creativity", "Self-Care", "Responsibility", "Social Connection", "Rest"

Rules:
- Always speak directly to the person. Never say "the user" or "this person."
- Consider all selected emotions together and proportionally
- Never let one negative emotion override several positive or neutral ones
- Acknowledge mixed emotions as natural — do not treat them as a problem
- Do not diagnose mental health conditions
- Do not psychoanalyze or assign hidden meanings
- Do not make alarming or dramatic conclusions
- Do not tell someone how they should feel or what they should do
- Do not be preachy, clinical, or generic
- Be warm and human — like someone who actually listened
- Return valid JSON only`,
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  };

  let resp = await postGroq(apiKey, body, 30_000);

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    if (isJsonValidationFailure(resp.status, text)) {
      const retryBody: GroqRequestBody = { ...body };
      delete retryBody.response_format;
      resp = await postGroq(apiKey, retryBody, 30_000);

      if (resp.ok) {
        const json: any = await resp.json();
        const raw = String(json?.choices?.[0]?.message?.content || "").trim();
        const parsed = parseJsonObject(raw);
        if (!parsed) {
          throw new Error(`Failed to parse Groq JSON response: ${raw}`);
        }

        return moodAnalysisFromParsed(parsed);
      }

      const retryText = await resp.text().catch(() => "");
      throw new Error(`Groq error ${resp.status}: ${retryText}`);
    }
    throw new Error(`Groq error ${resp.status}: ${text}`);
  }

  const json: any = await resp.json();
  const raw = String(json?.choices?.[0]?.message?.content || "").trim();

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    throw new Error(`Failed to parse Groq JSON response: ${raw}`);
  }

  return moodAnalysisFromParsed(parsed);
}
