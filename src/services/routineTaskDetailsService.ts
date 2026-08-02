const CEREBRAS_CHAT_COMPLETIONS_URL = "https://api.cerebras.ai/v1/chat/completions";
const DEFAULT_CEREBRAS_ROUTINE_DETAILS_MODEL = "gpt-oss-120b";
const CEREBRAS_TIMEOUT_MS = 45_000;

export interface RoutineTaskDetailsObstacle {
  obstacle: string;
  solution: string;
}

export interface RoutineTaskDetailsRequest {
  title: string;
  description: string;
  context: string;
  purpose: string;
  trigger: string;
  triggerType?: string | null;
  environment: string;
  reward: string;
  consequence: string;
  steps: string[];
  supplies: string[];
  obstacles: RoutineTaskDetailsObstacle[];
}

export interface RoutineTaskDetailsResult {
  title: string;
  description: string;
  purpose: string;
  trigger: string;
  triggerType: string | null;
  environment: string;
  reward: string;
  consequence: string;
  steps: string[];
  supplies: string[];
  obstacles: RoutineTaskDetailsObstacle[];
}

type CerebrasResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    } | null;
  }>;
};

type CerebrasErrorBody = {
  error?: unknown;
  message?: unknown;
};

type ParsedRoutineTaskDetails = Partial<RoutineTaskDetailsResult>;

const TRIGGER_TYPES = [
  "Visual",
  "Object",
  "Location",
  "Time",
  "Person",
  "Sound",
  "Existing Habit",
];

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanOptionalTriggerType(value: unknown): string | null {
  const text = cleanText(value);
  return TRIGGER_TYPES.includes(text) ? text : null;
}

function cleanTextArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(cleanText)
    .filter(Boolean)
    .slice(0, max);
}

function cleanObstacleArray(value: unknown, max: number): RoutineTaskDetailsObstacle[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const obstacle = cleanText(record.obstacle);
      if (!obstacle) return null;
      return {
        obstacle,
        solution: cleanText(record.solution),
      };
    })
    .filter((item): item is RoutineTaskDetailsObstacle => item !== null)
    .slice(0, max);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((chunk) => {
      if (typeof chunk === "string") return chunk;
      if (!chunk || typeof chunk !== "object") return "";
      const record = chunk as Record<string, unknown>;
      return cleanText(record.text) || cleanText(record.content);
    })
    .filter(Boolean)
    .join("");
}

function errorMessage(body: CerebrasErrorBody | null): string {
  const error = body?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return cleanText(record.message) || cleanText(record.type) || "Cerebras error";
  }

  return cleanText(body?.message) || "Cerebras error";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function sanitizeResult(parsed: ParsedRoutineTaskDetails): RoutineTaskDetailsResult {
  const result: RoutineTaskDetailsResult = {
    title: cleanText(parsed.title),
    description: cleanText(parsed.description),
    purpose: cleanText(parsed.purpose),
    trigger: cleanText(parsed.trigger),
    triggerType: cleanOptionalTriggerType(parsed.triggerType),
    environment: cleanText(parsed.environment),
    reward: cleanText(parsed.reward),
    consequence: cleanText(parsed.consequence),
    steps: cleanTextArray(parsed.steps, 9),
    supplies: cleanTextArray(parsed.supplies, 12),
    obstacles: cleanObstacleArray(parsed.obstacles, 9),
  };

  if (!result.title || !result.description || !result.purpose) {
    throw new Error("Cerebras returned incomplete routine task details");
  }

  return result;
}

export async function fillRoutineTaskDetails(
  input: RoutineTaskDetailsRequest,
): Promise<RoutineTaskDetailsResult> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error("Missing CEREBRAS_API_KEY");

  const model =
    process.env.CEREBRAS_ROUTINE_DETAILS_MODEL ||
    DEFAULT_CEREBRAS_ROUTINE_DETAILS_MODEL;

  const systemPrompt = `You fill out routine task detail fields for a polished iOS routine app.

Use the user's Context as the main source of truth. Preserve any existing field text when it is useful, but complete missing or weak fields with specific, concise language.

Return only valid JSON. No markdown.

Do not include Motivation, Why This Trigger Works, or Recovery Plan. Those fields are not available.

Allowed triggerType values:
${TRIGGER_TYPES.map((type) => `- ${type}`).join("\n")}

JSON format:
{
  "title": "Short task title",
  "description": "One short description sentence",
  "purpose": "Why this task exists",
  "trigger": "What signals this task should begin",
  "triggerType": "One allowed trigger type or null",
  "environment": "Where this task is normally done",
  "reward": "What the user gets for completing this",
  "consequence": "What happens if this gets skipped",
  "steps": ["Concrete step 1", "Concrete step 2"],
  "supplies": ["Supply 1"],
  "obstacles": [
    { "obstacle": "Likely obstacle", "solution": "Specific solution" }
  ]
}`;

  const body = {
    model,
    temperature: 0.35,
    max_tokens: 1400,
    ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          task: input,
          instruction:
            "Fill every visible routine task add/edit text field. Keep the result practical, concrete, and specific to the user's context.",
        }),
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CEREBRAS_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(CEREBRAS_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (isAbortError(error)) {
      throw new Error("Cerebras request timed out after 45s");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const json = (await response.json().catch(() => null)) as
    | CerebrasResponse
    | CerebrasErrorBody
    | null;

  if (!response.ok) {
    throw new Error(
      `Cerebras error ${response.status}: ${errorMessage(json as CerebrasErrorBody | null)}`,
    );
  }

  const raw = contentToText((json as CerebrasResponse | null)?.choices?.[0]?.message?.content)
    .trim();

  let parsed: ParsedRoutineTaskDetails;

  try {
    parsed = JSON.parse(raw) as ParsedRoutineTaskDetails;
  } catch (error: unknown) {
    console.error("[routine-task-details/fill] JSON parse error:", error);
    throw new Error(`Failed to parse Cerebras JSON response: ${raw}`);
  }

  return sanitizeResult(parsed);
}
