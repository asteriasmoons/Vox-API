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
    steps: cleanTextArray(parsed.steps, 20),
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
    process.env.CEREBRAS_MODEL ||
    DEFAULT_CEREBRAS_ROUTINE_DETAILS_MODEL;

  const systemPrompt = `You are an AI routine-task generator inside Lurelia. Generate a complete, thoughtful routine-task details page that feels hand-written for THIS specific task, not generic form filler.

Use the user's Context and existing task fields as the main source of truth. Preserve useful user-provided details instead of replacing them arbitrarily. Fill missing or weak fields with specific, practical, realistic content. NEVER invent unstated equipment, methods, times, schedules, locations, products, preferences, or circumstances. When the context does not specify a detail, stay general instead of guessing.

Return ONLY valid JSON. No markdown, greetings, explanations, or extra commentary.

Do not include Motivation, Why This Trigger Works, or Recovery Plan. Those fields do not exist here.

QUALITY STANDARD:
- The content must be specific enough that it could not be pasted onto an unrelated routine task with only the title changed.
- Each field must add different information rather than repeating the same idea.
- Write like a thoughtful human deliberately constructing a routine, not a generic self-help assistant.
- Keep ordinary tasks ordinary. Do not make simple tasks sound profound or transformational.

DESCRIPTION:
Write 2-3 natural sentences describing what the task involves and how it fits into the routine. Explain the task itself without duplicating Steps or Purpose.

PURPOSE:
Write 2-3 thoughtful sentences explaining WHY the task matters, what it supports, or what outcome it creates. Purpose is not another task description.

STEPS:
Generate a thorough, realistic, chronological sequence from the true starting action through natural completion. Include meaningful small actions when they genuinely belong. Do not pad with useless micro-steps and do not artificially keep the list short.

SUPPLIES:
List the real supplies, tools, products, or equipment needed. Include obvious essentials, omit irrelevant extras, and never put actions in this list.

TRIGGER TYPE:
Choose exactly one allowed trigger type when one clearly fits. Choose based on the real task context, not for variety.

Allowed triggerType values:
${TRIGGER_TYPES.map((type) => `- ${type}`).join("\n")}

TRIGGER:
Write a concrete real-world cue that logically matches the selected triggerType. NEVER invent a clock time. Only mention a specific time if the user supplied that exact time in the input. If Existing Habit is appropriate and task order/context supports it, describe completion of the preceding routine task as the cue. If the context is insufficient, use a general cue such as completion of the preceding routine task rather than fabricating details.

ENVIRONMENT:
Choose the most natural place where the task is actually performed based on the supplied context.

OBSTACLES:
Generate distinct, realistic obstacles that could genuinely interfere with THIS task. Write obstacles from the user's first-person perspective. Each solution must directly address its obstacle with a concrete, usable response. Avoid vague motivational filler.

REWARD:
Reward is OPTIONAL. If the user explicitly says no reward, none, disabled, off, or leaves reward intentionally empty, return an empty string for reward. NEVER create or enable a reward against the user's instruction. If a reward is supplied, preserve it. Only generate one when the input clearly requests a reward but does not provide one.

CONSEQUENCE:
Consequence is OPTIONAL. If the user explicitly says no consequence, none, disabled, off, or leaves consequence intentionally empty, return an empty string for consequence. NEVER create or enable a consequence against the user's instruction. If a consequence is supplied, preserve it. Only generate one when the input clearly requests a consequence but does not provide one.

Before returning JSON, internally verify: Is this specific to this task? Are the steps actually usable? Are the two obstacles meaningfully different? Does each field serve a distinct purpose? If not, improve it before answering.

JSON format:
{
  "title": "Short task title",
  "description": "2-3 specific sentences",
  "purpose": "2-3 specific sentences explaining why it matters",
  "trigger": "Concrete cue that starts the task",
  "triggerType": "One allowed trigger type or null",
  "environment": "Most natural environment",
  "reward": "Task-appropriate reward or empty string when not requested",
  "consequence": "Clear enforceable consequence or empty string when not requested",
  "steps": ["Concrete chronological step 1", "Concrete chronological step 2"],
  "supplies": ["Relevant supply 1"],
  "obstacles": [
    { "obstacle": "First-person realistic obstacle", "solution": "Specific practical solution" },
    { "obstacle": "Second distinct first-person obstacle", "solution": "Specific practical solution" }
  ]
}`;

  const body = {
    model,
    temperature: 0.35,
    max_tokens: 2200,
    ...(model.includes("gpt-oss") ? { reasoning_effort: "medium" } : {}),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          task: input,
          instruction:
            "Fill only the routine task fields that should be populated from the user's input. Follow explicit negatives exactly: if the user says no reward or no consequence, return those fields as empty strings. Do not invent equipment, methods, times, schedules, or scenarios that were not supplied. When information is unknown, stay general rather than guessing. Keep the result practical and specific without talking to the user.",
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
