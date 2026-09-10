import { groqChatJson } from "./groqAIClient";

const WORKING_TIMING_GROQ_MODEL =
  process.env.WORKING_TIMING_GROQ_MODEL || "openai/gpt-oss-120b";

export const TIMING_PLANETS = [
  "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn",
  "Uranus", "Neptune",
] as const;

export const TIMING_MOON_PHASES = [
  "New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
  "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent",
] as const;

export const TIMING_ASPECTS = [
  "Conjunction", "Sextile", "Square", "Trine", "Opposition",
] as const;

export type TimingPlanet = (typeof TIMING_PLANETS)[number];
export type TimingMoonPhase = (typeof TIMING_MOON_PHASES)[number];
export type TimingAspect = (typeof TIMING_ASPECTS)[number];

export type TimingPlanetPair = {
  first: TimingPlanet;
  second: TimingPlanet;
};

export type WorkingTimingProfile = {
  interpretedIntention: string;
  primaryIntention: string;
  secondaryIntentions: string[];
  planetaryRulers: TimingPlanet[];
  favorableMoonPhases: TimingMoonPhase[];
  favorableNumerologyNumbers: number[];
  favorableAspects: TimingAspect[];
  supportivePlanetPairs: TimingPlanetPair[];
  challengingPlanetPairs: TimingPlanetPair[];
  keywords: string[];
};

const SYSTEM_PROMPT = `
You interpret a user's magical working intention into a structured timing profile
for Sterium, a grimoire app. You do NOT choose a date or time. You only identify
symbolic correspondences that Sterium's local astronomy and numerology calculators
can later score.

Return JSON only. Use traditional/common magical correspondences rather than
inventing novel systems. Do not claim scientific certainty or guaranteed outcomes.

Allowed planets:
Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune

Allowed moon phases:
New Moon, Waxing Crescent, First Quarter, Waxing Gibbous, Full Moon,
Waning Gibbous, Last Quarter, Waning Crescent

Allowed aspects:
Conjunction, Sextile, Square, Trine, Opposition
`;
function userPrompt(intention: string): string {
  return `
Interpret this working intention:

"${intention}"

Return exactly this JSON shape:
{
  "interpretedIntention": "brief plain-language interpretation",
  "primaryIntention": "one concise magical intention category",
  "secondaryIntentions": ["zero to three concise related intention categories"],
  "planetaryRulers": ["one to four allowed planets"],
  "favorableMoonPhases": ["one to four allowed moon phases"],
  "favorableNumerologyNumbers": [1, 2],
  "favorableAspects": ["one to four allowed aspects"],
  "supportivePlanetPairs": [
    { "first": "Mercury", "second": "Jupiter" }
  ],
  "challengingPlanetPairs": [
    { "first": "Mercury", "second": "Neptune" }
  ],
  "keywords": ["four", "to", "eight", "keywords"]
}

Rules:
- Numerology numbers must be integers 1 through 9.
- Planet pairs must use only allowed planets.
- Favor supportive conditions that make symbolic sense for the intention.
- Challenging pairs are optional and may be an empty array.
- Keep categories and keywords concise.
- Do not include prose outside JSON.
`;
}
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function allowedValues<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  max: number,
): T[number][] {
  const allowedSet = new Set<string>(allowed);
  return asStringArray(value)
    .filter((item): item is T[number] => allowedSet.has(item))
    .slice(0, max);
}

function numberValues(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 9),
  )).slice(0, 5);
}

function planetPairs(value: unknown): TimingPlanetPair[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(TIMING_PLANETS);
  const result: TimingPlanetPair[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const first = typeof record.first === "string" ? record.first.trim() : "";
    const second = typeof record.second === "string" ? record.second.trim() : "";
    if (!allowed.has(first) || !allowed.has(second) || first === second) continue;
    result.push({ first: first as TimingPlanet, second: second as TimingPlanet });
    if (result.length >= 6) break;
  }

  return result;
}

function parseProfile(raw: string): WorkingTimingProfile {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Timing profile response did not contain JSON: ${raw}`);
  }

  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  const interpretedIntention =
    typeof parsed.interpretedIntention === "string" ? parsed.interpretedIntention.trim() : "";
  const primaryIntention =
    typeof parsed.primaryIntention === "string" ? parsed.primaryIntention.trim() : "";

  const profile: WorkingTimingProfile = {
    interpretedIntention,
    primaryIntention,
    secondaryIntentions: asStringArray(parsed.secondaryIntentions).slice(0, 3),
    planetaryRulers: allowedValues(parsed.planetaryRulers, TIMING_PLANETS, 4),
    favorableMoonPhases: allowedValues(parsed.favorableMoonPhases, TIMING_MOON_PHASES, 4),
    favorableNumerologyNumbers: numberValues(parsed.favorableNumerologyNumbers),
    favorableAspects: allowedValues(parsed.favorableAspects, TIMING_ASPECTS, 4),
    supportivePlanetPairs: planetPairs(parsed.supportivePlanetPairs),
    challengingPlanetPairs: planetPairs(parsed.challengingPlanetPairs),
    keywords: asStringArray(parsed.keywords).slice(0, 8),
  };

  if (!profile.interpretedIntention || !profile.primaryIntention) {
    throw new Error("Timing profile response is missing intention fields");
  }
  if (
    profile.planetaryRulers.length === 0 &&
    profile.favorableMoonPhases.length === 0 &&
    profile.favorableNumerologyNumbers.length === 0 &&
    profile.favorableAspects.length === 0
  ) {
    throw new Error("Timing profile response contains no usable correspondences");
  }

  return profile;
}

export async function generateWorkingTimingProfile(
  intention: string,
): Promise<WorkingTimingProfile> {
  const raw = await groqChatJson(SYSTEM_PROMPT, userPrompt(intention), {
    stage: "working-timing-profile",
    model: WORKING_TIMING_GROQ_MODEL,
    temperature: 0.15,
    maxTokens: 2000,
  });

  return parseProfile(raw);
}
