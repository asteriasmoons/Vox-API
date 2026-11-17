const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export type MoodStatsBehaviorKey =
  | "screenTime"
  | "socialUsage"
  | "nighttimeUse"
  | "pickups"
  | "notifications";

export interface MoodStatsSummaryInput {
  averageMoodPercent: number;
  checkInCount: number;
  bestDay: string;
  hardestDay: string;
}

export interface MoodStatsPhoneBehaviorInput {
  screenTimeMinutes: number;
  socialAppMinutes: number;
  nighttimePhoneMinutes: number;
  pickupCount: number;
  notificationCount: number;
}

export interface MoodStatsRecentSnapshotInput extends MoodStatsPhoneBehaviorInput {
  date: string;
  averageMoodPercent: number;
  checkInCount: number;
}

export interface MoodStatsContextRequest {
  userId?: string;
  date: string;
  moodSummary: MoodStatsSummaryInput;
  phoneBehavior: MoodStatsPhoneBehaviorInput;
  recentSnapshots?: MoodStatsRecentSnapshotInput[];
}

export interface MoodStatsBehaviorInsight {
  key: MoodStatsBehaviorKey;
  insight: string;
}

export interface MoodStatsContextResponse {
  summary: string;
  behaviors: MoodStatsBehaviorInsight[];
  generatedAt: string;
}

const BEHAVIOR_KEYS: MoodStatsBehaviorKey[] = [
  "screenTime",
  "socialUsage",
  "nighttimeUse",
  "pickups",
  "notifications",
];

const FALLBACK_INSIGHTS: Record<MoodStatsBehaviorKey, string> = {
  screenTime:
    "Screen time may align with the shape of your mood patterns, especially as more daily check-ins are added.",
  socialUsage:
    "Social app time may sit alongside mood shifts, though this estimate depends on available Screen Time categories.",
  nighttimeUse:
    "Nighttime phone use may align with lower restfulness or heavier mood days when it appears repeatedly.",
  pickups:
    "Frequent pickups may reflect checking patterns that sit near restless or scattered emotional moments.",
  notifications:
    "Notification volume may line up with days that feel more interrupted or overstimulating.",
};

const SYSTEM_PROMPT = `You write gentle phone behavior context for a wellness app called Lunixia.

The app sends only aggregate mood and phone totals. Your job is to describe possible correlations, not causes.

Rules:
- Be warm, simple, and non-clinical.
- Never diagnose, advise, prescribe, or tell the user what to do.
- Never say phone behavior caused a mood.
- Use phrases like "may align with", "may sit near", or "can appear alongside".
- Do not mention raw privacy details, app names, medical terms, addiction, disorder, anxiety diagnosis, depression diagnosis, or treatment.
- Keep the summary to one short sentence.
- Return exactly five behavior insights, one for each key: screenTime, socialUsage, nighttimeUse, pickups, notifications.
- Each behavior insight must be one sentence, 16 to 32 words.

Return only a JSON object with exactly this shape:
{
  "summary": "A short overall pattern insight.",
  "behaviors": [
    { "key": "screenTime", "insight": "..." },
    { "key": "socialUsage", "insight": "..." },
    { "key": "nighttimeUse", "insight": "..." },
    { "key": "pickups", "insight": "..." },
    { "key": "notifications", "insight": "..." }
  ]
}`;

export async function generateMoodStatsContext(
  input: MoodStatsContextRequest,
): Promise<MoodStatsContextResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const body = {
    model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    temperature: 0.55,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          date: input.date,
          moodSummary: input.moodSummary,
          phoneBehavior: input.phoneBehavior,
          recentSnapshots: input.recentSnapshots ?? [],
        }),
      },
    ],
  };

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Groq error ${resp.status}: ${text}`);
  }

  const json: any = await resp.json();
  const raw = String(json?.choices?.[0]?.message?.content || "").trim();
  if (!raw) throw new Error("Groq returned empty context");

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse Groq mood stats JSON response");
  }

  return normalizeMoodStatsContext(parsed);
}

function normalizeMoodStatsContext(parsed: any): MoodStatsContextResponse {
  const summary = cleanSentence(
    parsed?.summary,
    "Your phone patterns may align with your mood data as Lunixia gathers more daily snapshots.",
  );
  const rawBehaviors = Array.isArray(parsed?.behaviors) ? parsed.behaviors : [];

  const behaviors = BEHAVIOR_KEYS.map((key) => {
    const match = rawBehaviors.find((item: any) => item?.key === key);
    return {
      key,
      insight: cleanSentence(match?.insight, FALLBACK_INSIGHTS[key]),
    };
  });

  return {
    summary,
    behaviors,
    generatedAt: new Date().toISOString(),
  };
}

function cleanSentence(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return fallback;
  if (text.length <= 240) return text;
  return `${text.slice(0, 237).trim()}...`;
}
