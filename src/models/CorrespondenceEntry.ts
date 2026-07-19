import { Schema, Document, Model } from "mongoose";
import { asteriumDB } from "../config/databases";
import type {
  ChakraAssociation,
  ColorCorrespondence,
  CorrespondenceType,
  DayOfWeekAssociation,
  LunarPhaseAssociation,
  NumerologyAssociation,
  SeasonAssociation,
  TarotAssociation,
} from "../services/correspondenceEngineService";

export interface CorrespondenceEntryDoc extends Document {
  type: CorrespondenceType;
  name: string;
  normalizedName: string;
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
  createdAt: Date;
  updatedAt: Date;
}

const NamedExplanationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    explanation: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const NumerologySchema = new Schema(
  {
    number: { type: String, required: true, trim: true },
    significance: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const TarotSchema = new Schema(
  {
    card: { type: String, required: true, trim: true },
    explanation: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const LunarPhaseSchema = new Schema(
  {
    phase: { type: String, required: true, trim: true },
    explanation: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const SeasonSchema = new Schema(
  {
    season: { type: String, required: true, trim: true },
    explanation: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const DayOfWeekSchema = new Schema(
  {
    day: { type: String, required: true, trim: true },
    explanation: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const ColorSchema = new Schema(
  {
    color: { type: String, required: true, trim: true },
    meaning: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const CorrespondenceEntrySchema = new Schema<CorrespondenceEntryDoc>(
  {
    type: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, index: true },
    intentions: { type: [String], default: [] },
    purposes: { type: [String], default: [] },
    alternativeNames: { type: [String], default: [] },
    scientificName: { type: String, default: "" },
    shortDescription: { type: String, required: true, trim: true },
    planetaryCorrespondences: { type: [String], default: [] },
    zodiacCorrespondences: { type: [String], default: [] },
    elementalCorrespondences: { type: [String], default: [] },
    deities: { type: [String], default: [] },
    chakraAssociations: { type: [NamedExplanationSchema], default: [] },
    numerology: { type: [NumerologySchema], default: [] },
    tarotAssociations: { type: [TarotSchema], default: [] },
    sabbats: { type: [String], default: [] },
    lunarPhases: { type: [LunarPhaseSchema], default: [] },
    seasons: { type: [SeasonSchema], default: [] },
    daysOfWeek: { type: [DayOfWeekSchema], default: [] },
    colorCorrespondences: { type: [ColorSchema], default: [] },
    symbols: { type: [String], default: [] },
    usesInSpellwork: { type: [String], default: [] },
    usesInRitual: { type: String, default: "" },
    usage: { type: String, default: "" },
    divinationAssociations: { type: String, default: "" },
    spiritualMeanings: { type: [String], default: [] },
    historicalNotes: { type: String, default: "" },
    folklore: { type: String, default: "" },
    warnings: { type: String, default: "" },
    source: { type: String, required: true, default: "ai" },
  },
  { timestamps: true },
);

CorrespondenceEntrySchema.index(
  { type: 1, normalizedName: 1 },
  { unique: true },
);

export const CorrespondenceEntry: Model<CorrespondenceEntryDoc> =
  (asteriumDB.models.CorrespondenceEntry as Model<CorrespondenceEntryDoc>) ||
  asteriumDB.model<CorrespondenceEntryDoc>(
    "CorrespondenceEntry",
    CorrespondenceEntrySchema,
  );
