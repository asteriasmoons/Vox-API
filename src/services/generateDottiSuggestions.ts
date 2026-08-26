import { cerebrasChatJson } from "./cerebrasAIClient";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DottiEnergy =
  | "very_low"
  | "low"
  | "moderate"
  | "good"
  | "high";

export type DottiBodyState =
  | "feeling_good"
  | "general_fatigue"
  | "back_discomfort"
  | "muscle_soreness"
  | "low_mobility"
  | "gentle_day";

export type DottiRoom =
  | "bathroom"
  | "bedroom"
  | "kitchen"
  | "living_room"
  | "laundry"
  | "entryway"
  | "office"
  | "outdoor"
  | "whole_home"
  | "other";

export type DottiEffort = "gentle" | "light" | "moderate";

export interface DottiSuggestionsInput {
  energy: DottiEnergy;
  bodyStates: DottiBodyState[];
  durationMinutes: number;
  assignedRooms: DottiRoom[];
}

export interface DottiSuggestedTask {
  title: string;
  icon?: string;   // optional asset name from the app's icon catalog
  minutes: number;
  effort: DottiEffort;
}

export interface DottiSuggestionGroup {
  room: DottiRoom;
  tasks: DottiSuggestedTask[];
}

export interface DottiSuggestionsResult {
  groups: DottiSuggestionGroup[];
}

// ---------------------------------------------------------------------------
// Validation helpers (manual — matches house style, no zod)
// ---------------------------------------------------------------------------

const ENERGY_VALUES: readonly DottiEnergy[] = [
  "very_low", "low", "moderate", "good", "high",
];

const BODY_VALUES: readonly DottiBodyState[] = [
  "feeling_good", "general_fatigue", "back_discomfort",
  "muscle_soreness", "low_mobility", "gentle_day",
];

const ROOM_VALUES: readonly DottiRoom[] = [
  "bathroom", "bedroom", "kitchen", "living_room", "laundry",
  "entryway", "office", "outdoor", "whole_home", "other",
];

const EFFORT_VALUES: readonly DottiEffort[] = ["gentle", "light", "moderate"];

const ALLOWED_DURATIONS = new Set<number>([5, 15, 30, 60]);

function isEnergy(v: unknown): v is DottiEnergy {
  return typeof v === "string" && (ENERGY_VALUES as readonly string[]).includes(v);
}

function isBodyState(v: unknown): v is DottiBodyState {
  return typeof v === "string" && (BODY_VALUES as readonly string[]).includes(v);
}

function isRoom(v: unknown): v is DottiRoom {
  return typeof v === "string" && (ROOM_VALUES as readonly string[]).includes(v);
}

function isEffort(v: unknown): v is DottiEffort {
  return typeof v === "string" && (EFFORT_VALUES as readonly string[]).includes(v);
}

export function parseDottiInput(body: unknown): DottiSuggestionsInput {
  if (!body || typeof body !== "object") {
    throw new Error("body must be a JSON object");
  }
  const record = body as Record<string, unknown>;

  const energy = record.energy;
  if (!isEnergy(energy)) {
    throw new Error(`energy must be one of: ${ENERGY_VALUES.join(", ")}`);
  }

  const bodyStatesRaw = record.bodyStates;
  const bodyStates: DottiBodyState[] = [];
  if (bodyStatesRaw !== undefined && bodyStatesRaw !== null) {
    if (!Array.isArray(bodyStatesRaw)) {
      throw new Error("bodyStates must be an array of strings");
    }
    for (const raw of bodyStatesRaw) {
      if (!isBodyState(raw)) {
        throw new Error(`bodyStates contains an unknown value: ${String(raw)}`);
      }
      bodyStates.push(raw);
    }
  }

  const duration = record.durationMinutes;
  if (typeof duration !== "number" || !Number.isFinite(duration) || !ALLOWED_DURATIONS.has(duration)) {
    throw new Error("durationMinutes must be one of: 5, 15, 30, 60");
  }

  const assignedRoomsRaw = record.assignedRooms;
  const assignedRooms: DottiRoom[] = [];
  if (assignedRoomsRaw !== undefined && assignedRoomsRaw !== null) {
    if (!Array.isArray(assignedRoomsRaw)) {
      throw new Error("assignedRooms must be an array of strings");
    }
    if (assignedRoomsRaw.length > 3) {
      throw new Error("assignedRooms can include at most 3 rooms");
    }
    for (const raw of assignedRoomsRaw) {
      if (!isRoom(raw)) {
        throw new Error(`assignedRooms contains an unknown value: ${String(raw)}`);
      }
      assignedRooms.push(raw);
    }
  }

  return { energy, bodyStates, durationMinutes: duration, assignedRooms };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Dotti, a gentle housekeeping companion. You suggest a small number of realistic home-care tasks based on the user's current energy, body state, and available time.

Your voice: calm, warm, encouraging. Never demanding. Never medical. Never judgmental. Never uses the words "should", "must", "overdue", "missed", or "failed".

Return a JSON object with this exact shape:
{
  "groups": [
    {
      "room": "<one of: bathroom | bedroom | kitchen | living_room | laundry | entryway | office | outdoor | whole_home | other>",
      "tasks": [
        {
          "title": "<short imperative sentence, 3-8 words>",
          "icon": "<optional icon name from the allowed list>",
          "minutes": <integer, 1 to 20>,
          "effort": "<one of: gentle | light | moderate>"
        }
      ]
    }
  ]
}

Rules you MUST follow:

1. Total tasks across all groups is capped by time budget:
   - 5 minutes  -> 2 tasks
   - 15 minutes -> 3-4 tasks
   - 30 minutes -> 4-6 tasks
   - 60 minutes -> 6-8 tasks
   Do not exceed the upper bound. Fewer is always better than too many.

2. Reduce the cap by 1 when energy is "very_low" or "low".

3. Body-state constraints (respect ALL that apply):
   - back_discomfort or low_mobility -> no tasks that require bending, lifting, reaching high, or being on the floor. Prefer standing or seated wiping tasks.
   - muscle_soreness -> no tasks that require sustained standing, scrubbing, or repetitive motion.
   - general_fatigue or gentle_day -> only gentle effort tasks; prefer tidying and light wiping.
   - feeling_good -> full range is fine.

4. Effort ladder:
   - "gentle"   = wiping, tidying, replacing a towel, putting one thing away.
   - "light"    = short focused cleaning of a small surface.
   - "moderate" = a full-room reset or a longer sequence. Only include "moderate" if energy is "good" or "high" AND duration is 30 or 60 minutes.

5. Every task title is a specific, concrete action a person could recognize immediately. "Wipe the bathroom sink" — not "clean bathroom". Never use the room name as the title.

6. Group tasks by room. Each group must have at least 1 task. Do not include a room group with 0 tasks.

7. Assigned rooms are optional context from the user's calendar, not scheduled chores. When assigned rooms are provided, focus suggestions on those rooms when realistic for the user's energy, body state, and duration. If the assigned rooms do not fit the user's current capacity, return gentler whole_home or other suggestions instead. Never imply that the assigned rooms are due, overdue, required, or already tasks.

8. The "icon" field is optional. Include it only when a name from the allowed list clearly fits. Never invent an icon name.

Allowed icon names (partial, all lowercase, exact match required):
shower, towel, bottle, bed, bedpillow, hanger, drawers, dresser, kitchentable, coffeemaker, teapot, dishwasher, refrigerator, oven, silverware, whisk, sofa, armchair, lamp, television, laundry, washmachine, washer, hanger, frontdoor, dooropen, mailbox, exitdoor, office, document, pencil, notespen, yard, treeoutside, seedling, sun, cloudie, houseoutline, basketflowers, trash, bucket, spraybottle, paintbrush, vacuumcleaner, sparkle, heartfill.

Return ONLY the JSON object described above. No preamble, no trailing commentary.`;

function summarize(input: DottiSuggestionsInput): string {
  const bodyList = input.bodyStates.length > 0
    ? input.bodyStates.join(", ")
    : "no notes";
  const assignedRooms = input.assignedRooms.length > 0
    ? input.assignedRooms.join(", ")
    : "none";
  return [
    `Energy: ${input.energy}`,
    `Body state: ${bodyList}`,
    `Available time: ${input.durationMinutes} minutes`,
    `Assigned rooms for this date: ${assignedRooms}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

function normalizeGroups(raw: unknown): DottiSuggestionGroup[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const groups = record.groups;
  if (!Array.isArray(groups)) return [];

  const out: DottiSuggestionGroup[] = [];
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    const gr = g as Record<string, unknown>;

    const room: DottiRoom = isRoom(gr.room) ? gr.room : "other";
    const tasksRaw = gr.tasks;
    if (!Array.isArray(tasksRaw)) continue;

    const tasks: DottiSuggestedTask[] = [];
    for (const t of tasksRaw) {
      if (!t || typeof t !== "object") continue;
      const tr = t as Record<string, unknown>;

      const title = typeof tr.title === "string" ? tr.title.trim() : "";
      if (!title) continue;

      const minutesRaw = tr.minutes;
      const minutes = typeof minutesRaw === "number" && Number.isFinite(minutesRaw)
        ? Math.max(1, Math.min(20, Math.round(minutesRaw)))
        : 5;

      const effort: DottiEffort = isEffort(tr.effort) ? tr.effort : "gentle";

      const iconRaw = tr.icon;
      const icon = typeof iconRaw === "string" && iconRaw.trim().length > 0
        ? iconRaw.trim()
        : undefined;

      const task: DottiSuggestedTask = { title, minutes, effort };
      if (icon !== undefined) task.icon = icon;
      tasks.push(task);
    }

    if (tasks.length > 0) {
      out.push({ room, tasks });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function generateDottiSuggestions(
  input: DottiSuggestionsInput,
): Promise<DottiSuggestionsResult> {
  const raw = await cerebrasChatJson(
    SYSTEM_PROMPT,
    summarize(input),
    {
      stage: "dotti_suggestions",
      temperature: 0.7,
      maxTokens: 700,
    },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse Cerebras JSON: ${raw.slice(0, 200)}`);
  }

  const groups = normalizeGroups(parsed);
  if (groups.length === 0) {
    throw new Error("Cerebras returned no valid suggestion groups");
  }
  return { groups };
}
