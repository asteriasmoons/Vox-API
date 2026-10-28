//
//  celestialGenerationService.ts
//  Builds and runs one Groq generation STAGE for a celestial event. Astronomy
//  facts supplied by Sterium are treated as authoritative — Groq is asked only
//  for interpretive, magical, historical, and educational content, in strict
//  JSON, validated before it is returned.
//

import { groqChatJson } from "../groqAIClient";
import { celestialRateLimiter } from "./celestialRateLimiter";
import { CelestialEventKnowledge } from "../../models/CelestialEventKnowledge";
import {
  CelestialEventPayload,
  CelestialStage,
  validateStage,
} from "./celestialTypes";

export const CELESTIAL_GROQ_MODEL =
  process.env.CELESTIAL_GROQ_MODEL || "openai/gpt-oss-120b";

const STAGE_MAX_TOKENS: Record<CelestialStage, number> = {
  overviewAstrology: 3200,
  correspondences: 3200,
  practices: 3600,
  knowledgeReflection: 3600,
};

const SYSTEM_PROMPT = `
You write content for Sterium, a polished witchcraft app, for an audience interested in
witchcraft, magical practice, astrology, lunar magic, celestial symbolism, and folklore.

Rules:
- The astronomical facts provided are CALCULATED by Sterium and are authoritative. Never
  recompute, contradict, or restate them as if you determined them. Do NOT invent event
  times, magnitudes, positions, or classifications.
- Generate ONLY the interpretive, magical, historical, and educational content requested.
- Write for THIS specific event. Be substantive, atmospheric, specific, and non-repetitive.
- Do not fabricate historical events, folklore, deities, traditions, or citations. If a
  reliable basis is lacking, omit the claim. Attribute a culture/tradition when you present
  historical material, and distinguish documented history from modern magical interpretation.
- Avoid generic AI phrasing, repeated intros, disclaimers, and filler.
- Return VALID JSON ONLY — no prose outside the JSON, no markdown fences.
`.trim();

function line(label: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== undefined && v !== null && String(v).trim() !== "");
    if (items.length === 0) return null;
    return `- ${label}: ${items.join(", ")}`;
  }
  return `- ${label}: ${String(value)}`;
}

function factsBlock(p: CelestialEventPayload): string {
  const lines = [
    line("Event name", p.name),
    line("Type", p.type),
    line("Category", p.category),
    line("Classification", p.classification),
    line("Existing description", p.description),
    line("Peak (UTC)", p.peakDate),
    line("Starts (UTC)", p.startDate),
    line("Ends (UTC)", p.endDate),
    line("Duration (seconds)", p.durationSeconds),
    line("Time zone", p.timeZoneIdentifier),
    line("Zodiac sign", p.zodiacSign),
    line("Planets", p.planets),
    line("Aspect", p.aspect),
    line("Lunar phase", p.lunarPhase),
    line("Lunar sign", p.lunarSign),
    line("Elements", p.elements),
    line("Eclipse/other magnitude", p.magnitude),
    line("Earth-Moon distance (km)", p.earthMoonDistanceKm),
    line("Radiant constellation", p.radiantConstellation),
    line("Parent body", p.parentBody),
    line("Zenithal hourly rate", p.zenithalHourlyRate),
    line("Moon illumination (%)", p.moonIlluminationPercent),
    line("Hemisphere/season", p.hemisphereSeason),
  ].filter(Boolean) as string[];

  if (p.metadata) {
    for (const [k, v] of Object.entries(p.metadata)) {
      const l = line(`meta.${k}`, v);
      if (l) lines.push(l);
    }
  }
  return lines.join("\n");
}

const STAGE_INSTRUCTIONS: Record<CelestialStage, string> = {
  overviewAstrology: `
Generate the OVERVIEW + ASTROLOGY section as JSON of EXACTLY this shape:
{
  "title": string,
  "subtitle": string,
  "overview": string,
  "magicalSignificance": string,
  "coreThemes": string[],
  "energeticInterpretation": string,
  "astrology": {
    "context": string,
    "zodiacInfluences": string,
    "planetaryInfluences": string,
    "elementalAssociations": string[],
    "energeticThemes": string[],
    "symbolicInterpretations": string,
    "personalReflection": string
  }
}
Use the supplied zodiac/planet/element facts; do not invent placements. Omit associations
that do not apply rather than forcing them.`.trim(),

  correspondences: `
Generate MAGICAL CORRESPONDENCES as JSON of EXACTLY this shape. Each correspondence is
{ "name": string, "explanation": string }:
{
  "intentions": Correspondence[],
  "crystals": Correspondence[],
  "herbs": Correspondence[],
  "colors": Correspondence[],
  "elements": Correspondence[],
  "deities": Correspondence[],
  "symbols": Correspondence[],
  "tools": Correspondence[],
  "altarSuggestions": string[]
}
Provide meaningful associations appropriate to THIS event. Do not attribute correspondences
to a specific tradition without a reliable basis. Leave a category as [] if nothing fits.`.trim(),

  practices: `
Generate MAGICAL PRACTICES as JSON of EXACTLY this shape:
{
  "rituals": [ { "title": string, "purpose": string, "description": string,
                 "materials": string[], "steps": string[], "intentions": string[] } ],
  "spellwork": [ { "title": string, "description": string } ],
  "divination": [ { "title": string, "description": string } ],
  "meditation": [ { "title": string, "description": string } ],
  "journalingPrompts": string[],
  "personalPractices": string[]
}
Provide several DISTINCT practices appropriate to this specific event (2-4 rituals with clear
steps). Do not reuse generic rituals unrelated to the event.`.trim(),

  knowledgeReflection: `
Generate EVENT-SPECIFIC KNOWLEDGE, HISTORY/FOLKLORE, and REFLECTION as JSON of EXACTLY this shape:
{
  "eventSpecificTitle": string,
  "eventSpecificPoints": string[],
  "history": string,
  "folklore": [ { "culture": string, "text": string } ],
  "traditions": [ { "culture": string, "text": string } ],
  "modernInterpretations": string,
  "reflectionQuestions": string[],
  "affirmations": string[],
  "suggestedIntentions": string[],
  "closingInsight": string
}
Tailor eventSpecificPoints to this event type. For folklore/traditions, name the culture and
only include well-grounded material; omit anything you cannot support. Clearly keep modern
magical interpretation separate from documented history.`.trim(),
};

function parseJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Groq response contained no JSON object");
    return JSON.parse(match[0]);
  }
}

async function reusableKnowledge(type: string): Promise<string> {
  try {
    const doc = await CelestialEventKnowledge.findOne({ key: type }).lean();
    if (!doc || !doc.content) return "";
    return `\nReusable context already known for this event type (use/refine, do not contradict):\n${JSON.stringify(doc.content).slice(0, 1500)}`;
  } catch {
    return "";
  }
}

/** Generates and validates one stage. Throws on malformed output (caller retries). */
export async function generateCelestialStage(
  stage: CelestialStage,
  payload: CelestialEventPayload,
): Promise<Record<string, unknown>> {
  const knowledge = await reusableKnowledge(payload.type);
  const userPrompt = [
    `EVENT FACTS (authoritative, calculated by Sterium):`,
    factsBlock(payload),
    knowledge,
    "",
    STAGE_INSTRUCTIONS[stage],
  ].join("\n");

  await celestialRateLimiter.acquire();

  const raw = await groqChatJson(SYSTEM_PROMPT, userPrompt, {
    stage: `celestial-${stage}`,
    model: CELESTIAL_GROQ_MODEL,
    temperature: 0.7,
    maxTokens: STAGE_MAX_TOKENS[stage],
  });

  const parsed = parseJson(raw);
  const result = validateStage(stage, parsed);
  if (!result.ok) {
    throw new Error(`Celestial stage ${stage} failed validation: ${result.reason}`);
  }
  return parsed as Record<string, unknown>;
}

/** Light, non-fabricated reusable-knowledge upsert from a completed overview. */
export async function upsertReusableKnowledge(
  type: string,
  overview: Record<string, unknown> | undefined,
): Promise<void> {
  if (!overview) return;
  const content = {
    coreThemes: (overview as any).coreThemes ?? [],
    magicalSignificance: (overview as any).magicalSignificance ?? "",
  };
  try {
    await CelestialEventKnowledge.updateOne(
      { key: type },
      { $set: { content }, $setOnInsert: { key: type, contentVersion: 1 } },
      { upsert: true },
    );
  } catch {
    // Non-fatal; knowledge reuse is an optimization only.
  }
}
