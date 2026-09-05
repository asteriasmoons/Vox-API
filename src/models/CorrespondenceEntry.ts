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
  foods?: string[];
  drinks?: string[];
  waysToCelebrate?: string[];
  ritualIdeas?: string[];
  activities?: string[];
  decorations?: string[];
  altarIdeas?: string[];
  herbsAndPlants?: string[];
  crystalsAndStones?: string[];
  incenseAndScents?: string[];
  seasonalThemes?: string[];
  botanicalFamily?: string;
  partsUsed?: string[];
  preparationMethods?: string[];
  harvestingAndStorage?: string;
  commonSubstitutions?: string[];
  complementaryHerbs?: string[];
  smokeAndIncenseUses?: string[];
  bloomingSeason?: string[];
  preservationMethods?: string[];
  floralSymbolism?: string[];
  traditionalGiftMeanings?: string[];
  complementaryFlowers?: string[];
  mineralFamily?: string;
  composition?: string;
  hardness?: string;
  crystalSystem?: string;
  commonColorsAndVarieties?: string[];
  cleansingMethods?: string[];
  chargingMethods?: string[];
  sourcePlant?: string;
  plantPartUsed?: string;
  aromaProfile?: string;
  blendingNotes?: string;
  complementaryOils?: string[];
  shadesAndVariations?: string[];
  candleMagicUses?: string[];
  visualizationUses?: string[];
  planetaryDay?: string;
  planetaryHour?: string;
  traditionalMetal?: string;
  associatedHerbs?: string[];
  associatedCrystals?: string[];
  magicalDomains?: string[];
  modality?: string;
  polarity?: string;
  rulingPlanet?: string;
  houseAssociation?: string;
  symbolMeaning?: string;
  energeticQualities?: string[];
  strengthsAndWeaknesses?: string[];
  energeticTheme?: string;
  bestMagicalWork?: string[];
  seasonalFoods?: string[];
  seasonalDrinks?: string[];
  seasonalPlants?: string[];
  seasonalAnimals?: string[];
  seasonalActivities?: string[];
  magicalFocus?: string[];
  associatedColors?: string[];
  deityAssociations?: string[];
  direction?: string;
  qualities?: string[];
  associatedTools?: string[];
  associatedSpirits?: string[];
  associatedWeather?: string[];
  invocationMethods?: string[];
  altarRepresentation?: string;
  arcana?: string;
  suit?: string;
  numberOrRank?: string;
  element?: string;
  astrologicalAssociation?: string;
  uprightMeaning?: string;
  reversedMeaning?: string;
  keywords?: string[];
  imageryAndSymbolism?: string;
  yesNoAssociation?: string;
  timingAssociation?: string;
  cultureTradition?: string;
  pantheon?: string;
  domains?: string[];
  epithetsTitles?: string[];
  sacredAnimals?: string[];
  sacredPlants?: string[];
  sacredPlaces?: string[];
  offerings?: string[];
  devotionalActs?: string[];
  festivalsHolyDays?: string[];
  mythsAndStories?: string;
  historicalWorship?: string;
  modernDevotionalPractices?: string[];
  spiritType?: string;
  culturalContext?: string;
  domainsAssociations?: string[];
  appearanceDescriptions?: string;
  signsAndPresence?: string[];
  communicationMethods?: string[];
  relatedSpirits?: string[];
  protectiveConsiderations?: string;
  habitat?: string;
  behavioralTraits?: string[];
  symbolicTraits?: string[];
  omensAndSigns?: string[];
  dreamMeaning?: string;
  encounterMeaning?: string;
  associatedSeasons?: string[];
  spiritGuideInterpretations?: string;
  culturalSymbolism?: string;
  toolType?: string;
  traditionalPurpose?: string;
  howToUse?: string;
  preparation?: string;
  cleansing?: string;
  consecration?: string;
  charging?: string;
  storage?: string;
  materials?: string[];
  commonVariations?: string[];
  substitutions?: string[];
  ritualApplications?: string[];
  spellworkApplications?: string[];
  coreMeaning?: string;
  positiveExpression?: string;
  shadowExpression?: string;
  repeatingNumberMeaning?: string;
  synchronicityMeaning?: string;
  manifestationAssociation?: string;
  divinationMeaning?: string;
  tarotConnections?: string[];
  astrologicalConnections?: string[];
  sacredGeometrySymbolism?: string;
  culturalHistoricalMeanings?: string[];
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
    foods: { type: [String], default: undefined },
    drinks: { type: [String], default: undefined },
    waysToCelebrate: { type: [String], default: undefined },
    ritualIdeas: { type: [String], default: undefined },
    activities: { type: [String], default: undefined },
    decorations: { type: [String], default: undefined },
    altarIdeas: { type: [String], default: undefined },
    herbsAndPlants: { type: [String], default: undefined },
    crystalsAndStones: { type: [String], default: undefined },
    incenseAndScents: { type: [String], default: undefined },
    seasonalThemes: { type: [String], default: undefined },
    botanicalFamily: { type: String, default: undefined },
    partsUsed: { type: [String], default: undefined },
    preparationMethods: { type: [String], default: undefined },
    harvestingAndStorage: { type: String, default: undefined },
    commonSubstitutions: { type: [String], default: undefined },
    complementaryHerbs: { type: [String], default: undefined },
    smokeAndIncenseUses: { type: [String], default: undefined },
    bloomingSeason: { type: [String], default: undefined },
    preservationMethods: { type: [String], default: undefined },
    floralSymbolism: { type: [String], default: undefined },
    traditionalGiftMeanings: { type: [String], default: undefined },
    complementaryFlowers: { type: [String], default: undefined },
    mineralFamily: { type: String, default: undefined },
    composition: { type: String, default: undefined },
    hardness: { type: String, default: undefined },
    crystalSystem: { type: String, default: undefined },
    commonColorsAndVarieties: { type: [String], default: undefined },
    cleansingMethods: { type: [String], default: undefined },
    chargingMethods: { type: [String], default: undefined },
    sourcePlant: { type: String, default: undefined },
    plantPartUsed: { type: String, default: undefined },
    aromaProfile: { type: String, default: undefined },
    blendingNotes: { type: String, default: undefined },
    complementaryOils: { type: [String], default: undefined },
    shadesAndVariations: { type: [String], default: undefined },
    candleMagicUses: { type: [String], default: undefined },
    visualizationUses: { type: [String], default: undefined },
    planetaryDay: { type: String, default: undefined },
    planetaryHour: { type: String, default: undefined },
    traditionalMetal: { type: String, default: undefined },
    associatedHerbs: { type: [String], default: undefined },
    associatedCrystals: { type: [String], default: undefined },
    magicalDomains: { type: [String], default: undefined },
    modality: { type: String, default: undefined },
    polarity: { type: String, default: undefined },
    rulingPlanet: { type: String, default: undefined },
    houseAssociation: { type: String, default: undefined },
    symbolMeaning: { type: String, default: undefined },
    energeticQualities: { type: [String], default: undefined },
    strengthsAndWeaknesses: { type: [String], default: undefined },
    energeticTheme: { type: String, default: undefined },
    bestMagicalWork: { type: [String], default: undefined },
    seasonalFoods: { type: [String], default: undefined },
    seasonalDrinks: { type: [String], default: undefined },
    seasonalPlants: { type: [String], default: undefined },
    seasonalAnimals: { type: [String], default: undefined },
    seasonalActivities: { type: [String], default: undefined },
    magicalFocus: { type: [String], default: undefined },
    associatedColors: { type: [String], default: undefined },
    deityAssociations: { type: [String], default: undefined },
    direction: { type: String, default: undefined },
    qualities: { type: [String], default: undefined },
    associatedTools: { type: [String], default: undefined },
    associatedSpirits: { type: [String], default: undefined },
    associatedWeather: { type: [String], default: undefined },
    invocationMethods: { type: [String], default: undefined },
    altarRepresentation: { type: String, default: undefined },
    arcana: { type: String, default: undefined },
    suit: { type: String, default: undefined },
    numberOrRank: { type: String, default: undefined },
    element: { type: String, default: undefined },
    astrologicalAssociation: { type: String, default: undefined },
    uprightMeaning: { type: String, default: undefined },
    reversedMeaning: { type: String, default: undefined },
    keywords: { type: [String], default: undefined },
    imageryAndSymbolism: { type: String, default: undefined },
    yesNoAssociation: { type: String, default: undefined },
    timingAssociation: { type: String, default: undefined },
    cultureTradition: { type: String, default: undefined },
    pantheon: { type: String, default: undefined },
    domains: { type: [String], default: undefined },
    epithetsTitles: { type: [String], default: undefined },
    sacredAnimals: { type: [String], default: undefined },
    sacredPlants: { type: [String], default: undefined },
    sacredPlaces: { type: [String], default: undefined },
    offerings: { type: [String], default: undefined },
    devotionalActs: { type: [String], default: undefined },
    festivalsHolyDays: { type: [String], default: undefined },
    mythsAndStories: { type: String, default: undefined },
    historicalWorship: { type: String, default: undefined },
    modernDevotionalPractices: { type: [String], default: undefined },
    spiritType: { type: String, default: undefined },
    culturalContext: { type: String, default: undefined },
    domainsAssociations: { type: [String], default: undefined },
    appearanceDescriptions: { type: String, default: undefined },
    signsAndPresence: { type: [String], default: undefined },
    communicationMethods: { type: [String], default: undefined },
    relatedSpirits: { type: [String], default: undefined },
    protectiveConsiderations: { type: String, default: undefined },
    habitat: { type: String, default: undefined },
    behavioralTraits: { type: [String], default: undefined },
    symbolicTraits: { type: [String], default: undefined },
    omensAndSigns: { type: [String], default: undefined },
    dreamMeaning: { type: String, default: undefined },
    encounterMeaning: { type: String, default: undefined },
    associatedSeasons: { type: [String], default: undefined },
    spiritGuideInterpretations: { type: String, default: undefined },
    culturalSymbolism: { type: String, default: undefined },
    toolType: { type: String, default: undefined },
    traditionalPurpose: { type: String, default: undefined },
    howToUse: { type: String, default: undefined },
    preparation: { type: String, default: undefined },
    cleansing: { type: String, default: undefined },
    consecration: { type: String, default: undefined },
    charging: { type: String, default: undefined },
    storage: { type: String, default: undefined },
    materials: { type: [String], default: undefined },
    commonVariations: { type: [String], default: undefined },
    substitutions: { type: [String], default: undefined },
    ritualApplications: { type: [String], default: undefined },
    spellworkApplications: { type: [String], default: undefined },
    coreMeaning: { type: String, default: undefined },
    positiveExpression: { type: String, default: undefined },
    shadowExpression: { type: String, default: undefined },
    repeatingNumberMeaning: { type: String, default: undefined },
    synchronicityMeaning: { type: String, default: undefined },
    manifestationAssociation: { type: String, default: undefined },
    divinationMeaning: { type: String, default: undefined },
    tarotConnections: { type: [String], default: undefined },
    astrologicalConnections: { type: [String], default: undefined },
    sacredGeometrySymbolism: { type: String, default: undefined },
    culturalHistoricalMeanings: { type: [String], default: undefined },
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
