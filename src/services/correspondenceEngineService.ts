import { CorrespondenceEntry } from "../models/CorrespondenceEntry";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "moonshotai/kimi-k2-instruct-0905";

export const CORRESPONDENCE_TYPES = [
  "herb",
  "flower",
  "crystal",
  "essential_oil",
  "color",
  "planet",
  "zodiac_sign",
  "lunar_phase",
  "sabbat",
  "season",
  "day_of_week",
  "element",
  "tarot_card",
  "deity",
  "spirit",
  "animal",
  "tool",
  "number",
] as const;

export type CorrespondenceType = (typeof CORRESPONDENCE_TYPES)[number];

export type ChakraAssociation = {
  name: string;
  explanation: string;
};

export type NumerologyAssociation = {
  number: string;
  significance: string;
};

export type TarotAssociation = {
  card: string;
  explanation: string;
};

export type LunarPhaseAssociation = {
  phase: string;
  explanation: string;
};

export type SeasonAssociation = {
  season: string;
  explanation: string;
};

export type DayOfWeekAssociation = {
  day: string;
  explanation: string;
};

export type ColorCorrespondence = {
  color: string;
  meaning: string;
};

export type CorrespondenceEntryResponse = {
  type: CorrespondenceType;
  name: string;
  intentions: string[];
  purposes: string[];
  alternativeNames: string[];
  scientificName: string;
  shortDescription: string;
  planetaryCorrespondences: string[];
  zodiacCorrespondences: string[];
  elementalCorrespondences: string[];
  deities: string[];
  chakraAssociations: ChakraAssociation[];
  numerology: NumerologyAssociation[];
  tarotAssociations: TarotAssociation[];
  sabbats: string[];
  lunarPhases: LunarPhaseAssociation[];
  seasons: SeasonAssociation[];
  daysOfWeek: DayOfWeekAssociation[];
  colorCorrespondences: ColorCorrespondence[];
  symbols: string[];
  usesInSpellwork: string[];
  usesInRitual: string;
  usage: string;
  divinationAssociations: string;
  spiritualMeanings: string[];
  historicalNotes: string;
  folklore: string;
  warnings: string;
  cached: boolean;
  source: "ai";
  createdAt?: string;
  updatedAt?: string;
};

type GroqChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type GenerateCorrespondenceOptions = {
  refresh?: boolean;
};

const TYPE_ALIASES: Record<string, CorrespondenceType> = {
  herb: "herb",
  herbs: "herb",
  flower: "flower",
  flowers: "flower",
  crystal: "crystal",
  crystals: "crystal",
  essentialoil: "essential_oil",
  essentialoils: "essential_oil",
  essential_oil: "essential_oil",
  essential_oils: "essential_oil",
  oil: "essential_oil",
  oils: "essential_oil",
  color: "color",
  colors: "color",
  colour: "color",
  colours: "color",
  planet: "planet",
  planets: "planet",
  zodiac: "zodiac_sign",
  zodiacs: "zodiac_sign",
  zodiacsign: "zodiac_sign",
  zodiacsigns: "zodiac_sign",
  zodiac_sign: "zodiac_sign",
  zodiac_signs: "zodiac_sign",
  lunarphase: "lunar_phase",
  lunarphases: "lunar_phase",
  lunar_phase: "lunar_phase",
  lunar_phases: "lunar_phase",
  moonphase: "lunar_phase",
  moonphases: "lunar_phase",
  sabbat: "sabbat",
  sabbats: "sabbat",
  season: "season",
  seasons: "season",
  day: "day_of_week",
  days: "day_of_week",
  weekday: "day_of_week",
  weekdays: "day_of_week",
  dayofweek: "day_of_week",
  daysoftheweek: "day_of_week",
  day_of_week: "day_of_week",
  days_of_week: "day_of_week",
  element: "element",
  elements: "element",
  tarot: "tarot_card",
  tarotcard: "tarot_card",
  tarotcards: "tarot_card",
  tarot_card: "tarot_card",
  tarot_cards: "tarot_card",
  deity: "deity",
  deities: "deity",
  spirit: "spirit",
  spirits: "spirit",
  animal: "animal",
  animals: "animal",
  tool: "tool",
  tools: "tool",
  number: "number",
  numbers: "number",
  numerology: "number",
};

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeCorrespondenceType(type: string): CorrespondenceType | null {
  const normalized = type
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z_]/g, "");

  return TYPE_ALIASES[normalized] ?? null;
}

function titleForType(type: CorrespondenceType): string {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

function namedExplanationArray(value: unknown): ChakraAssociation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      name: String((item as { name?: unknown })?.name ?? "").trim(),
      explanation: String(
        (item as { explanation?: unknown })?.explanation ?? "",
      ).trim(),
    }))
    .filter((item) => item.name.length > 0 && item.explanation.length > 0);
}

function numerologyArray(value: unknown): NumerologyAssociation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      number: String((item as { number?: unknown })?.number ?? "").trim(),
      significance: String(
        (item as { significance?: unknown })?.significance ?? "",
      ).trim(),
    }))
    .filter((item) => item.number.length > 0 && item.significance.length > 0);
}

function tarotArray(value: unknown): TarotAssociation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      card: String((item as { card?: unknown })?.card ?? "").trim(),
      explanation: String(
        (item as { explanation?: unknown })?.explanation ?? "",
      ).trim(),
    }))
    .filter((item) => item.card.length > 0 && item.explanation.length > 0);
}

function lunarPhaseArray(value: unknown): LunarPhaseAssociation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      phase: String((item as { phase?: unknown })?.phase ?? "").trim(),
      explanation: String(
        (item as { explanation?: unknown })?.explanation ?? "",
      ).trim(),
    }))
    .filter((item) => item.phase.length > 0 && item.explanation.length > 0);
}

function seasonArray(value: unknown): SeasonAssociation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      season: String((item as { season?: unknown })?.season ?? "").trim(),
      explanation: String(
        (item as { explanation?: unknown })?.explanation ?? "",
      ).trim(),
    }))
    .filter((item) => item.season.length > 0 && item.explanation.length > 0);
}

function dayOfWeekArray(value: unknown): DayOfWeekAssociation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      day: String((item as { day?: unknown })?.day ?? "").trim(),
      explanation: String(
        (item as { explanation?: unknown })?.explanation ?? "",
      ).trim(),
    }))
    .filter((item) => item.day.length > 0 && item.explanation.length > 0);
}

function colorArray(value: unknown): ColorCorrespondence[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      color: String((item as { color?: unknown })?.color ?? "").trim(),
      meaning: String((item as { meaning?: unknown })?.meaning ?? "").trim(),
    }))
    .filter((item) => item.color.length > 0 && item.meaning.length > 0);
}

function parseAIResponse(
  raw: string,
  type: CorrespondenceType,
  fallbackName: string,
): Omit<CorrespondenceEntryResponse, "cached" | "source" | "createdAt" | "updatedAt"> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`AI returned no JSON object: ${raw}`);
  }

  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  const name = String(parsed.name ?? fallbackName).trim() || fallbackName;
  const shortDescription = String(parsed.shortDescription ?? "").trim();

  if (!shortDescription) {
    throw new Error(`AI returned no shortDescription: ${raw}`);
  }

  return {
    type,
    name,
    intentions: stringArray(parsed.intentions).slice(0, 15),
    purposes: stringArray(parsed.purposes).slice(0, 15),
    alternativeNames: stringArray(parsed.alternativeNames),
    scientificName: String(parsed.scientificName ?? "").trim(),
    shortDescription,
    planetaryCorrespondences: stringArray(parsed.planetaryCorrespondences),
    zodiacCorrespondences: stringArray(parsed.zodiacCorrespondences),
    elementalCorrespondences: stringArray(parsed.elementalCorrespondences),
    deities: stringArray(parsed.deities),
    chakraAssociations: namedExplanationArray(parsed.chakraAssociations),
    numerology: numerologyArray(parsed.numerology),
    tarotAssociations: tarotArray(parsed.tarotAssociations),
    sabbats: stringArray(parsed.sabbats),
    lunarPhases: lunarPhaseArray(parsed.lunarPhases),
    seasons: seasonArray(parsed.seasons),
    daysOfWeek: dayOfWeekArray(parsed.daysOfWeek),
    colorCorrespondences: colorArray(parsed.colorCorrespondences),
    symbols: stringArray(parsed.symbols),
    usesInSpellwork: stringArray(parsed.usesInSpellwork).slice(0, 10),
    usesInRitual: String(parsed.usesInRitual ?? "").trim(),
    usage: String(parsed.usage ?? "").trim(),
    divinationAssociations: String(parsed.divinationAssociations ?? "").trim(),
    spiritualMeanings: stringArray(parsed.spiritualMeanings),
    historicalNotes: String(parsed.historicalNotes ?? "").trim(),
    folklore: String(parsed.folklore ?? "").trim(),
    warnings: String(parsed.warnings ?? "").trim(),
  };
}

function buildPrompt(type: CorrespondenceType, name: string): string {
  return `
I am building a comprehensive grimoire app called Asterium.

Generate one complete correspondence database entry for:
Category: ${titleForType(type)}
Name: ${name}

Return valid JSON only. Use exactly this schema:
{
  "name": "Title Case name",
  "intentions": ["5 to 15 concise intentions"],
  "purposes": ["5 to 15 practical magical or spiritual purposes"],
  "alternativeNames": ["common names, historical names, regional names, nicknames"],
  "scientificName": "accepted scientific or Latin name, or empty string",
  "shortDescription": "2 to 4 sentence overview",
  "planetaryCorrespondences": ["traditionally associated planets"],
  "zodiacCorrespondences": ["traditionally associated zodiac signs"],
  "elementalCorrespondences": ["primary elemental associations"],
  "deities": ["notable traditionally associated deities"],
  "chakraAssociations": [{"name": "chakra", "explanation": "brief connection"}],
  "numerology": [{"number": "number", "significance": "brief significance"}],
  "tarotAssociations": [{"card": "card", "explanation": "brief connection"}],
  "sabbats": ["associated Sabbats"],
  "lunarPhases": [{"phase": "phase", "explanation": "brief connection"}],
  "seasons": [{"season": "season", "explanation": "brief connection"}],
  "daysOfWeek": [{"day": "weekday", "explanation": "traditional planetary connection"}],
  "colorCorrespondences": [{"color": "color", "meaning": "what it represents"}],
  "symbols": ["traditional symbols"],
  "usesInSpellwork": ["5 to 10 concise magical applications"],
  "usesInRitual": "how it is traditionally used in ritual, offerings, meditation, cleansing, or altar work",
  "usage": "how to use, prepare, handle, store, or work with it safely and effectively",
  "divinationAssociations": "divination or symbolic interpretation associations, or empty string",
  "spiritualMeanings": ["1 to 3 concise paragraphs"],
  "historicalNotes": "brief historical overview",
  "folklore": "one or more myths, legends, or folklore notes",
  "warnings": "safety, toxicity, contraindications, ethical harvesting, or handling precautions, or empty string"
}

Rules:
- Be historically accurate where possible.
- Distinguish historical correspondences from modern Wiccan, New Age, or modern occult correspondences when they differ.
- Do not fabricate associations simply to complete every field.
- If information is uncertain, disputed, sparse, or varies between traditions, say that in the relevant field.
- Do not give medical, legal, or financial advice.
- Warnings must be practical and safety-focused when relevant.
- Return JSON only. No markdown. No preamble. No backticks.
`;
}

async function callGroq(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 2400,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Groq error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as GroqChatCompletionResponse;
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

function toResponse(
  doc: {
    type: CorrespondenceType;
    name: string;
    intentions: string[];
    purposes: string[];
    alternativeNames: string[];
    scientificName: string;
    shortDescription: string;
    planetaryCorrespondences: string[];
    zodiacCorrespondences: string[];
    elementalCorrespondences: string[];
    deities: string[];
    chakraAssociations: ChakraAssociation[];
    numerology: NumerologyAssociation[];
    tarotAssociations: TarotAssociation[];
    sabbats: string[];
    lunarPhases: LunarPhaseAssociation[];
    seasons: SeasonAssociation[];
    daysOfWeek: DayOfWeekAssociation[];
    colorCorrespondences: ColorCorrespondence[];
    symbols: string[];
    usesInSpellwork: string[];
    usesInRitual: string;
    usage: string;
    divinationAssociations: string;
    spiritualMeanings: string[];
    historicalNotes: string;
    folklore: string;
    warnings: string;
    source: "ai";
    createdAt?: Date;
    updatedAt?: Date;
  },
  cached: boolean,
): CorrespondenceEntryResponse {
  return {
    type: doc.type,
    name: doc.name,
    intentions: doc.intentions,
    purposes: doc.purposes,
    alternativeNames: doc.alternativeNames,
    scientificName: doc.scientificName,
    shortDescription: doc.shortDescription,
    planetaryCorrespondences: doc.planetaryCorrespondences,
    zodiacCorrespondences: doc.zodiacCorrespondences,
    elementalCorrespondences: doc.elementalCorrespondences,
    deities: doc.deities,
    chakraAssociations: doc.chakraAssociations,
    numerology: doc.numerology,
    tarotAssociations: doc.tarotAssociations,
    sabbats: doc.sabbats,
    lunarPhases: doc.lunarPhases,
    seasons: doc.seasons,
    daysOfWeek: doc.daysOfWeek,
    colorCorrespondences: doc.colorCorrespondences,
    symbols: doc.symbols,
    usesInSpellwork: doc.usesInSpellwork,
    usesInRitual: doc.usesInRitual,
    usage: doc.usage,
    divinationAssociations: doc.divinationAssociations,
    spiritualMeanings: doc.spiritualMeanings,
    historicalNotes: doc.historicalNotes,
    folklore: doc.folklore,
    warnings: doc.warnings,
    cached,
    source: doc.source,
    ...(doc.createdAt !== undefined && { createdAt: doc.createdAt.toISOString() }),
    ...(doc.updatedAt !== undefined && { updatedAt: doc.updatedAt.toISOString() }),
  };
}

export async function getOrGenerateCorrespondence(
  type: CorrespondenceType,
  name: string,
  options: GenerateCorrespondenceOptions = {},
): Promise<CorrespondenceEntryResponse> {
  const normalizedName = normalizeName(name);

  if (!options.refresh) {
    const existing = await CorrespondenceEntry.findOne({
      type,
      normalizedName,
    }).lean();

    if (existing) {
      return toResponse(existing, true);
    }
  }

  const raw = await callGroq(buildPrompt(type, name));
  const parsed = parseAIResponse(raw, type, name);

  const saved = await CorrespondenceEntry.findOneAndUpdate(
    { type, normalizedName },
    {
      $set: {
        ...parsed,
        normalizedName,
        source: "ai",
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  ).lean();

  if (!saved) {
    throw new Error("Failed to save generated correspondence");
  }

  return toResponse(saved, false);
}
