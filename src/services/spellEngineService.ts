import { SpellEntry } from "../models/SpellEntry";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export const PRACTITIONER_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
] as const;

export type PractitionerLevel = (typeof PRACTITIONER_LEVELS)[number];

export const SPELL_CATEGORIES = [
  {
    id: "protection_cleansing",
    title: "Protection & Cleansing",
    intentions: [
      "Banishing",
      "Cleansing",
      "Protection",
      "Purification",
      "Grounding",
      "Release",
    ],
  },
  {
    id: "love_relationships",
    title: "Love & Relationships",
    intentions: [
      "Compassion",
      "Family",
      "Forgiveness",
      "Friendship",
      "Love",
      "Marriage",
      "Passion",
      "Reconciliation",
    ],
  },
  {
    id: "prosperity_success",
    title: "Prosperity & Success",
    intentions: [
      "Abundance",
      "Career",
      "Good Fortune",
      "Luck",
      "Opportunity",
      "Prosperity",
      "Success",
      "Wealth",
    ],
  },
  {
    id: "personal_growth",
    title: "Personal Growth",
    intentions: [
      "Acceptance",
      "Ambition",
      "Confidence",
      "Courage",
      "Determination",
      "Growth",
      "Leadership",
      "Motivation",
      "Personal Power",
      "Resilience",
      "Self-Confidence",
      "Self-Discovery",
      "Self-Love",
      "Transformation",
    ],
  },
  {
    id: "healing_wellness",
    title: "Healing & Wellness",
    intentions: [
      "Balance",
      "Emotional Healing",
      "Healing",
      "Happiness",
      "Harmony",
      "Hope",
      "Patience",
      "Peace",
      "Positivity",
      "Serenity",
      "Sleep",
      "Strength",
      "Vitality",
    ],
  },
  {
    id: "spirituality_divination",
    title: "Spirituality & Divination",
    intentions: [
      "Divination",
      "Dreams",
      "Intuition",
      "Manifestation",
      "Psychic Awareness",
      "Spiritual Growth",
    ],
  },
  {
    id: "wisdom_mind",
    title: "Wisdom & Mind",
    intentions: [
      "Clarity",
      "Communication",
      "Creativity",
      "Focus",
      "Inspiration",
      "Knowledge",
      "Memory",
      "Truth",
      "Wisdom",
    ],
  },
  {
    id: "life_change",
    title: "Life & Change",
    intentions: [
      "Beginnings",
      "Boundaries",
      "Change",
      "Commitment",
      "Gratitude",
      "Home",
      "Travel",
    ],
  },
] as const;

export type SpellCategoryId = (typeof SPELL_CATEGORIES)[number]["id"];

export type SpellIngredient = {
  name: string;
  purpose: string;
};

export type SpellStep = {
  step: number;
  instruction: string;
};

export type SpellEntryResponse = {
  category: SpellCategoryId;
  categoryTitle: string;
  intention: string;
  level: PractitionerLevel;
  context: string;
  title: string;
  focus: string;
  bestTiming: string;
  ingredients: SpellIngredient[];
  tools: string[];
  preparation: string;
  instructions: SpellStep[];
  affirmation: string;
  visualization: string;
  closing: string;
  aftercare: string;
  duration: string;
  notes: string;
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

type SpellGenerationInput = {
  category: SpellCategoryId;
  intention: string;
  level: PractitionerLevel;
  context: string;
  refresh?: boolean;
};

const CATEGORY_ALIASES: Record<string, SpellCategoryId> = SPELL_CATEGORIES.reduce(
  (aliases, category) => {
    aliases[category.id] = category.id;
    aliases[category.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] =
      category.id;
    return aliases;
  },
  {} as Record<string, SpellCategoryId>,
);

export function normalizeSpellCategory(
  value: string,
): SpellCategoryId | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  return CATEGORY_ALIASES[normalized] ?? null;
}

export function normalizePractitionerLevel(
  value: string,
): PractitionerLevel | null {
  const normalized = value.trim().toLowerCase();
  return PRACTITIONER_LEVELS.find((level) => level === normalized) ?? null;
}

export function getSpellCategory(category: SpellCategoryId) {
  return SPELL_CATEGORIES.find((item) => item.id === category) ?? null;
}

function normalizedContext(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeIntention(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

function ingredientArray(value: unknown): SpellIngredient[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      name: String((item as { name?: unknown })?.name ?? "").trim(),
      purpose: String((item as { purpose?: unknown })?.purpose ?? "").trim(),
    }))
    .filter((item) => item.name.length > 0 && item.purpose.length > 0);
}

function stepArray(value: unknown): SpellStep[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => ({
      step: Number((item as { step?: unknown })?.step ?? index + 1),
      instruction: String(
        (item as { instruction?: unknown })?.instruction ?? "",
      ).trim(),
    }))
    .filter((item) => Number.isFinite(item.step) && item.instruction.length > 0)
    .map((item, index) => ({ ...item, step: index + 1 }));
}

function buildPrompt(input: {
  categoryTitle: string;
  intention: string;
  level: PractitionerLevel;
  context: string;
}) {
  return `
You are an expert practitioner of folklore, historical folk magic, ceremonial magic,
herbal traditions, and modern witchcraft. Generate a complete, original spell based on
the user's selected magical category, intention, practitioner level, and personal context.

User input:
- Category: ${input.categoryTitle}
- Intention: ${input.intention}
- Practitioner level: ${titleCase(input.level)}
- Context and desired outcome: ${input.context}

Return valid JSON only with exactly this schema:
{
  "title": "unique memorable spell title",
  "category": "${input.categoryTitle}",
  "intention": "${input.intention}",
  "focus": "one or two concise sentences explaining what this spell accomplishes",
  "bestTiming": "ideal timing or that it may be performed at any time",
  "ingredients": [{"name": "ingredient", "purpose": "why it is included"}],
  "tools": ["tool or material"],
  "preparation": "pre-spell preparation",
  "instructions": [{"step": 1, "instruction": "clear step"}],
  "affirmation": "short affirmation, chant, invocation, or incantation",
  "visualization": "vivid but concise visualization",
  "closing": "how to respectfully conclude or seal the spell",
  "aftercare": "what to do with remaining ingredients or ritual items",
  "duration": "whether this is once, repeated, lunar timing, or continued",
  "notes": "substitutions, enhancements, practical tips, or empty string"
}

Rules:
- Adapt every section to the category, intention, level, and personal context.
- Beginner: simple language, common ingredients, minimal tools, clear steps, no assumed knowledge.
- Intermediate: include traditional correspondences and moderate ritual complexity while approachable.
- Advanced: may include layered symbolism, ceremonial techniques, planetary/lunar timing, historical correspondences, and nuanced practice.
- Favor historically inspired and symbolically meaningful correspondences over random ingredient selection.
- Avoid repeating information between sections.
- Never generate harmful, coercive, dangerous, illegal, or unsafe rituals.
- For love and relationship spells, focus on consent, self-work, harmony, openness, compassion, repair, or attraction without control over another person's will.
- For healing and wellness spells, do not make medical claims and do not replace professional care.
- Keep ingredients and tools practical and safe. Mention safety in aftercare or notes when needed.
- Any affirmation, chant, incantation, petition, or other spoken spell verse must rhyme naturally; use couplets or another consistent rhyme scheme rather than forced rhyme.
- Keep ritual forces consistent: never thank, release, dismiss, or otherwise address a planet, deity, spirit, ancestor, direction, element, or similar force unless the spell explicitly invoked, invited, or called upon it earlier.
- The completed spell should feel polished, immersive, original, and worthy of being saved in a personal grimoire.
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
      temperature: 0.8,
      max_tokens: 4000,
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

function parseAIResponse(
  raw: string,
  input: {
    category: SpellCategoryId;
    categoryTitle: string;
    intention: string;
    level: PractitionerLevel;
    context: string;
  },
): Omit<SpellEntryResponse, "cached" | "source" | "createdAt" | "updatedAt"> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`AI returned no JSON object: ${raw}`);
  }

  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  const instructions = stepArray(parsed.instructions);
  const ingredients = ingredientArray(parsed.ingredients);
  const title = String(parsed.title ?? "").trim();
  const focus = String(parsed.focus ?? "").trim();

  if (!title || !focus || instructions.length === 0 || ingredients.length === 0) {
    throw new Error(`AI returned incomplete spell: ${raw}`);
  }

  return {
    category: input.category,
    categoryTitle: input.categoryTitle,
    intention: input.intention,
    level: input.level,
    context: input.context,
    title,
    focus,
    bestTiming: String(parsed.bestTiming ?? "").trim(),
    ingredients,
    tools: stringArray(parsed.tools),
    preparation: String(parsed.preparation ?? "").trim(),
    instructions,
    affirmation: String(parsed.affirmation ?? "").trim(),
    visualization: String(parsed.visualization ?? "").trim(),
    closing: String(parsed.closing ?? "").trim(),
    aftercare: String(parsed.aftercare ?? "").trim(),
    duration: String(parsed.duration ?? "").trim(),
    notes: String(parsed.notes ?? "").trim(),
  };
}

function toResponse(
  doc: {
    category: SpellCategoryId;
    categoryTitle: string;
    intention: string;
    level: PractitionerLevel;
    context: string;
    title: string;
    focus: string;
    bestTiming: string;
    ingredients: SpellIngredient[];
    tools: string[];
    preparation: string;
    instructions: SpellStep[];
    affirmation: string;
    visualization: string;
    closing: string;
    aftercare: string;
    duration: string;
    notes: string;
    source: "ai";
    createdAt?: Date;
    updatedAt?: Date;
  },
  cached: boolean,
): SpellEntryResponse {
  return {
    category: doc.category,
    categoryTitle: doc.categoryTitle,
    intention: doc.intention,
    level: doc.level,
    context: doc.context,
    title: doc.title,
    focus: doc.focus,
    bestTiming: doc.bestTiming,
    ingredients: doc.ingredients,
    tools: doc.tools,
    preparation: doc.preparation,
    instructions: doc.instructions,
    affirmation: doc.affirmation,
    visualization: doc.visualization,
    closing: doc.closing,
    aftercare: doc.aftercare,
    duration: doc.duration,
    notes: doc.notes,
    cached,
    source: doc.source,
    ...(doc.createdAt !== undefined && { createdAt: doc.createdAt.toISOString() }),
    ...(doc.updatedAt !== undefined && { updatedAt: doc.updatedAt.toISOString() }),
  };
}

export async function getSavedSpellsForCategory(
  category: SpellCategoryId,
): Promise<SpellEntryResponse[]> {
  const spells = await SpellEntry.find({ category })
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  return spells.map((spell) => toResponse(spell, true));
}

export async function getOrGenerateSpell(
  input: SpellGenerationInput,
): Promise<SpellEntryResponse> {
  const category = getSpellCategory(input.category);
  if (!category) {
    throw new Error("Unsupported spell category");
  }

  const intention = normalizeIntention(input.intention);
  if (!category.intentions.includes(intention as never)) {
    throw new Error("Unsupported intention for category");
  }

  const context = input.context.trim().replace(/\s+/g, " ");
  const normalized = normalizedContext(context);

  if (!input.refresh) {
    const existing = await SpellEntry.findOne({
      category: input.category,
      intention,
      level: input.level,
      normalizedContext: normalized,
    }).lean();

    if (existing) {
      return toResponse(existing, true);
    }
  }

  const prompt = buildPrompt({
    categoryTitle: category.title,
    intention,
    level: input.level,
    context,
  });

  const raw = await callGroq(prompt);
  const parsed = parseAIResponse(raw, {
    category: input.category,
    categoryTitle: category.title,
    intention,
    level: input.level,
    context,
  });

  const saved = await SpellEntry.findOneAndUpdate(
    {
      category: input.category,
      intention,
      level: input.level,
      normalizedContext: normalized,
    },
    {
      $set: {
        ...parsed,
        normalizedContext: normalized,
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
    throw new Error("Failed to save generated spell");
  }

  return toResponse(saved, false);
}
