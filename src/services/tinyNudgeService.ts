const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

export type TinyNudgeTaskType = "reminder" | "habit";

export interface TinyNudgeRequest {
  taskType: TinyNudgeTaskType;
  taskName: string;
  friction: string;
}

export interface TinyNudgeResult {
  encouragement: string;
  frictionSuggestion: string;
}

interface GroqChoice {
  message?: {
    content?: string;
  };
}

interface GroqResponse {
  choices?: GroqChoice[];
}

interface TinyNudgeParsedResponse {
  encouragement?: unknown;
  frictionSuggestion?: unknown;
}

export async function generateTinyNudge(
  input: TinyNudgeRequest,
): Promise<TinyNudgeResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const body = {
    model: MODEL,
    temperature: 0.45,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a warm, grounded, emotionally intelligent motivational assistant.

The user has entered a specific friction point that is making a reminder or habit harder to start or complete.

Your job is to:
- Convince them to do the reminder or habit in a realistic, non-shaming way.
- Speak directly to the specific friction they gave.
- Make the task feel smaller, more possible, and less emotionally heavy.
- Give one practical suggestion for reducing the friction.

Tone:
- warm
- direct
- validating
- motivating
- human
- calm
- not cheesy
- not bossy
- not therapy-sounding

Rules:
- Do not shame the user.
- Do not overhype the task.
- Do not say "just do it."
- Do not give a long list.
- Do not diagnose the user.
- Do not mention being an AI.
- Do not use generic productivity advice.
- Stay specific to the task type, task name, and friction.
- The encouragement should feel like a convincing little nudge, not a lecture.

Return only valid JSON.

JSON format:
{
  "encouragement": "A short persuasive message convincing the user to do the reminder or habit.",
  "frictionSuggestion": "One practical suggestion for making the reminder or habit easier to start."
}`,
      },
      {
        role: "user",
        content: `Task type: ${input.taskType}
Task name: ${input.taskName}

User's friction: ${input.friction}

Convince me to do this ${input.taskType} and give me one suggestion for reducing the friction.`,
      },
    ],
  };

  console.log("[tiny-nudge] Sending request to Groq...");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let resp: Response;

  try {
    resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);

    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Groq request timed out after 60s");
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }

  console.log("[tiny-nudge] Groq status:", resp.status);

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("[tiny-nudge] Groq error body:", text);
    throw new Error(`Groq error ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as GroqResponse;
  const raw = String(json.choices?.[0]?.message?.content ?? "").trim();

  console.log("[tiny-nudge] Groq raw response:", raw);

  let parsed: TinyNudgeParsedResponse;

  try {
    parsed = JSON.parse(raw) as TinyNudgeParsedResponse;
  } catch (err: unknown) {
    console.error("[tiny-nudge] JSON parse error:", err);
    throw new Error(`Failed to parse Groq JSON response: ${raw}`);
  }

  const encouragement =
    typeof parsed.encouragement === "string" ? parsed.encouragement.trim() : "";

  const frictionSuggestion =
    typeof parsed.frictionSuggestion === "string"
      ? parsed.frictionSuggestion.trim()
      : "";

  if (!encouragement || !frictionSuggestion) {
    throw new Error("Groq returned incomplete Tiny Nudge fields");
  }

  return {
    encouragement,
    frictionSuggestion,
  };
}
