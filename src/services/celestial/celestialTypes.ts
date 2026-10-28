//
//  celestialTypes.ts
//  vox-api — Sterium celestial event AI interpretations
//
//  Shared types for the request payload Sterium sends, the stable event
//  fingerprint, and the strongly typed structured content produced by the four
//  Groq generation stages. Validators reject malformed Groq output before it is
//  persisted so fabricated/partial sections are never saved as complete.
//

import { createHash } from "crypto";

export const CELESTIAL_SCHEMA_VERSION = 1;
export const CELESTIAL_CONTENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Request payload (sent by the app when a user OPENS an event)
// ---------------------------------------------------------------------------

export interface CelestialEventPayload {
  id: string;
  name: string;
  type: string;
  category: string;
  classification?: string;
  description?: string;
  source?: string;
  modelVersion?: string;

  startDate?: string;
  peakDate: string;
  endDate?: string;
  durationSeconds?: number;
  timeZoneIdentifier?: string;
  uncertaintySeconds?: number;

  zodiacSign?: string;
  planets?: string[];
  aspect?: string;
  lunarPhase?: string;
  lunarSign?: string;
  elements?: string[];
  magnitude?: number;
  earthMoonDistanceKm?: number;
  radiantConstellation?: string;
  parentBody?: string;
  zenithalHourlyRate?: number;
  moonIlluminationPercent?: number;
  hemisphereSeason?: string;
  metadata?: Record<string, string>;

  schemaVersion?: number;
  contentVersion?: number;
  language?: string;
  fingerprint?: string;
}

// ---------------------------------------------------------------------------
// Stable fingerprint
// ---------------------------------------------------------------------------

function normalizeSlug(value: string | undefined | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
}

/** UTC calendar day (YYYY-MM-DD) of an ISO instant. Never the local day. */
export function utcDay(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d.toISOString().slice(0, 10);
}

/**
 * Canonical, stable occurrence identifier derived from the deterministic event
 * identity (category + type + normalized name + astrological identity) and the
 * UTC day of its peak. The same astronomical occurrence yields the same
 * fingerprint for every user, so interpretations and jobs are shared.
 */
export function computeFingerprint(payload: CelestialEventPayload): string {
  const identity = [
    normalizeSlug(payload.category),
    normalizeSlug(payload.type),
    normalizeSlug(payload.name),
    (payload.planets ?? []).map(normalizeSlug).filter(Boolean).sort().join("-"),
    normalizeSlug(payload.aspect),
    normalizeSlug(payload.zodiacSign ?? payload.lunarSign),
    normalizeSlug(payload.metadata?.showerCode),
    utcDay(payload.peakDate),
  ]
    .filter((part) => part && part.length > 0)
    .join("|");
  return createHash("sha256").update(identity).digest("hex").slice(0, 40);
}

// ---------------------------------------------------------------------------
// Generation stages
// ---------------------------------------------------------------------------

export type CelestialStage =
  | "overviewAstrology"
  | "correspondences"
  | "practices"
  | "knowledgeReflection";

export const CELESTIAL_STAGES: CelestialStage[] = [
  "overviewAstrology",
  "correspondences",
  "practices",
  "knowledgeReflection",
];

// ---- Structured content shapes ----

export interface NamedCorrespondence {
  name: string;
  explanation: string;
}

export interface RitualContent {
  title: string;
  purpose: string;
  description: string;
  materials: string[];
  steps: string[];
  intentions: string[];
}

export interface PracticeIdea {
  title: string;
  description: string;
}

export interface FolkloreItem {
  culture?: string;
  text: string;
}

export interface OverviewAstrologySection {
  title: string;
  subtitle: string;
  overview: string;
  magicalSignificance: string;
  coreThemes: string[];
  energeticInterpretation: string;
  astrology: {
    context: string;
    zodiacInfluences: string;
    planetaryInfluences: string;
    elementalAssociations: string[];
    energeticThemes: string[];
    symbolicInterpretations: string;
    personalReflection: string;
  };
}

export interface CorrespondencesSection {
  intentions: NamedCorrespondence[];
  crystals: NamedCorrespondence[];
  herbs: NamedCorrespondence[];
  colors: NamedCorrespondence[];
  elements: NamedCorrespondence[];
  deities: NamedCorrespondence[];
  symbols: NamedCorrespondence[];
  tools: NamedCorrespondence[];
  altarSuggestions: string[];
}

export interface PracticesSection {
  rituals: RitualContent[];
  spellwork: PracticeIdea[];
  divination: PracticeIdea[];
  meditation: PracticeIdea[];
  journalingPrompts: string[];
  personalPractices: string[];
}

export interface KnowledgeReflectionSection {
  eventSpecificTitle: string;
  eventSpecificPoints: string[];
  history: string;
  folklore: FolkloreItem[];
  traditions: FolkloreItem[];
  modernInterpretations: string;
  reflectionQuestions: string[];
  affirmations: string[];
  suggestedIntentions: string[];
  closingInsight: string;
}

export interface CelestialSections {
  overviewAstrology?: OverviewAstrologySection;
  correspondences?: CorrespondencesSection;
  practices?: PracticesSection;
  knowledgeReflection?: KnowledgeReflectionSection;
}

// ---------------------------------------------------------------------------
// Validation (reject malformed Groq output before persisting)
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isCorrespondenceArray(v: unknown): v is NamedCorrespondence[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => x && typeof x === "object" && isNonEmptyString((x as any).name) && isNonEmptyString((x as any).explanation))
  );
}

export function validateStage(stage: CelestialStage, data: unknown): { ok: boolean; reason?: string } {
  if (!data || typeof data !== "object") return { ok: false, reason: "not an object" };
  const d = data as any;

  switch (stage) {
    case "overviewAstrology":
      if (!isNonEmptyString(d.title)) return { ok: false, reason: "title" };
      if (!isNonEmptyString(d.overview)) return { ok: false, reason: "overview" };
      if (!isNonEmptyString(d.magicalSignificance)) return { ok: false, reason: "magicalSignificance" };
      if (!isStringArray(d.coreThemes) || d.coreThemes.length === 0) return { ok: false, reason: "coreThemes" };
      if (!d.astrology || typeof d.astrology !== "object") return { ok: false, reason: "astrology" };
      if (!isNonEmptyString(d.astrology.context)) return { ok: false, reason: "astrology.context" };
      return { ok: true };

    case "correspondences":
      for (const key of ["intentions", "crystals", "herbs", "colors"]) {
        if (!isCorrespondenceArray(d[key])) return { ok: false, reason: key };
      }
      // elements/deities/symbols/tools may be empty where not applicable.
      for (const key of ["elements", "deities", "symbols", "tools"]) {
        if (d[key] !== undefined && !Array.isArray(d[key])) return { ok: false, reason: key };
      }
      return { ok: true };

    case "practices":
      if (!Array.isArray(d.rituals) || d.rituals.length === 0) return { ok: false, reason: "rituals" };
      for (const r of d.rituals) {
        if (!isNonEmptyString(r?.title) || !isStringArray(r?.steps) || r.steps.length === 0) {
          return { ok: false, reason: "ritual.steps" };
        }
      }
      return { ok: true };

    case "knowledgeReflection":
      if (!isNonEmptyString(d.history) && !(Array.isArray(d.folklore) && d.folklore.length > 0)) {
        return { ok: false, reason: "history/folklore" };
      }
      if (!isStringArray(d.reflectionQuestions) || d.reflectionQuestions.length === 0) {
        return { ok: false, reason: "reflectionQuestions" };
      }
      return { ok: true };
  }
}
