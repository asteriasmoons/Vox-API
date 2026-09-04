const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";

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
  emotions: {
    name: string;
    category: "positive" | "neutral" | "negative";
  }[];
  activities: string[];
  sleepHours: number;
  exerciseMinutes: number;
  steps: number;
  meditationMinutes: number;
  waterOz: number;
  note: string;
  timestamp: string;
}

export interface MoodAnalysisResult {
  mindset: string;
  emotionalBalance: string;
  influences: string;
  reflection: string;
  themes: string[];
}

interface OpenRouterRequestBody {
  model: string;
  temperature: number;
  max_tokens: number;
  reasoning?: {
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    exclude?: boolean;
  };
  response_format?: unknown;
  messages: {
    role: "system" | "user";
    content: string;
  }[];
}

function parseJsonObject(
  raw: string,
): Record<string, unknown> | null {
  const content = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!content) return null;

  try {
    const parsed = JSON.parse(content);

    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);

    if (!match) return null;

    try {
      const parsed = JSON.parse(match[0]);

      return parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

async function postOpenRouter(
  apiKey: string,
  body: OpenRouterRequestBody,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    return await fetch(OPENROUTER_URL, {
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
      throw new Error(
        `OpenRouter request timed out after ${timeoutMs / 1000}s`,
      );
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function moodAnalysisFromParsed(
  parsed: Record<string, unknown>,
): MoodAnalysisResult {
  const mindset = String(
    parsed.mindset || "",
  ).trim();

  const emotionalBalance = String(
    parsed.emotionalBalance || "",
  ).trim();

  const influences = String(
    parsed.influences || "",
  ).trim();

  const reflection = String(
    parsed.reflection || "",
  ).trim();

  const themes = Array.isArray(parsed.themes)
    ? parsed.themes
        .map((t: any) => String(t).trim())
        .filter(Boolean)
    : [];

  if (
    !mindset ||
    !emotionalBalance ||
    !influences ||
    !reflection ||
    themes.length === 0
  ) {
    throw new Error(
      "OpenRouter returned incomplete mood analysis fields",
    );
  }

  return {
    mindset,
    emotionalBalance,
    influences,
    reflection,
    themes,
  };
}

export async function analyzeMood(
  input: MoodAnalysisInput,
): Promise<MoodAnalysisResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

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

  const lifestyleLines: string[] = [];

  if (input.sleepHours > 0) {
    lifestyleLines.push(
      `Sleep: ${input.sleepHours} hours`,
    );
  }

  if (input.exerciseMinutes > 0) {
    lifestyleLines.push(
      `Exercise: ${input.exerciseMinutes} minutes`,
    );
  }

  if (input.steps > 0) {
    lifestyleLines.push(
      `Steps: ${input.steps}`,
    );
  }

  if (input.meditationMinutes > 0) {
    lifestyleLines.push(
      `Mindfulness: ${input.meditationMinutes} minutes`,
    );
  }

  if (input.waterOz > 0) {
    lifestyleLines.push(
      `Water: ${input.waterOz} oz`,
    );
  }

  const userContent = `Mood log recorded in the ${timeOfDay} on ${date.toLocaleDateString(
    "en-US",
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  )}:

Positive emotions (${positiveEmotions.length}):
${positiveEmotions.join(", ") || "none"}

Neutral emotions (${neutralEmotions.length}):
${neutralEmotions.join(", ") || "none"}

Negative emotions (${negativeEmotions.length}):
${negativeEmotions.join(", ") || "none"}

Activities:
${input.activities.length > 0 ? input.activities.join(", ") : "none selected"}

Lifestyle:
${lifestyleLines.length > 0 ? lifestyleLines.join("\n") : "No lifestyle data recorded"}

${input.note ? `Note: "${input.note}"` : "No note provided"}`;

  const body: OpenRouterRequestBody = {
    model: MODEL,
    temperature: 0.1,
    max_tokens: 900,
    reasoning: {
      effort: "none",
      exclude: true,
    },
    response_format: RESPONSE_FORMAT,

    messages: [
      {
        role: "system",
        content: `You analyze mood logs for the wellness app Lunixia.

Write directly to the user using "you." Sound like an intelligent, warm friend who understands the full mood log without exaggerating it.

Use all selected emotions proportionally. A single negative emotion must not outweigh several positive or neutral emotions. Mixed emotions are normal and may coexist without needing explanation or resolution.

Use activities, lifestyle data, the note, and time of day only when they provide a reasonable influence or connection. Describe uncertain connections with words such as "may," "could," "seems," or "appears." Never present an inference as fact.

Do not:
- diagnose or psychoanalyze
- invent hidden meanings, motives, or emotions
- intensify the emotional state beyond what was logged
- tell the user what they should feel or do
- advise, coach, reassure, or therapize
- make dramatic or alarming conclusions
- flatten a mixed emotional state into one simplistic takeaway
- sound clinical, preachy, generic, or like a report

Return only the structured JSON required by the schema.

Field requirements:

mindset:
- 2-5 words
- captures the overall emotional feel
- natural and specific

emotionalBalance:
- 2-3 sentences
- describe how the selected emotions coexist
- consider all emotions proportionally
- acknowledge mixed emotions naturally when present

influences:
- 2-3 sentences
- describe plausible influences from activities, lifestyle data, note, or time of day
- stay tentative when the connection is uncertain
- do not invent causation

reflection:
- 3-5 conversational sentences
- bring the full mood log together
- acknowledge complexity when present
- speak directly to the user
- stay grounded in the recorded data

themes:
- 2-5 short theme labels
- Title Case
- derived from activities and emotional patterns
- concise and scannable`,
      },
      {
        role: "user",
        content: `Analyze this mood log as one complete picture. Keep the interpretation grounded in what was actually recorded and return the requested structured JSON.

${userContent}`,
      },
    ],
  };

  console.log(
    "[mood-analysis] Sending request to OpenRouter...",
  );

  const resp = await postOpenRouter(
    apiKey,
    body,
    30_000,
  );

  console.log(
    "[mood-analysis] OpenRouter status:",
    resp.status,
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");

    console.error(
      "[mood-analysis] OpenRouter error body:",
      text,
    );

    throw new Error(
      `OpenRouter error ${resp.status}: ${text}`,
    );
  }

  const json: any = await resp.json();

  const raw = String(
    json?.choices?.[0]?.message?.content || "",
  ).trim();

  console.log(
    "[mood-analysis] OpenRouter raw response:",
    raw,
  );

  const parsed = parseJsonObject(raw);

  if (!parsed) {
    throw new Error(
      `Failed to parse OpenRouter JSON response: ${raw}`,
    );
  }

  console.log(
    "[mood-analysis] Parsed:",
    JSON.stringify(parsed),
  );

  return moodAnalysisFromParsed(parsed);
}