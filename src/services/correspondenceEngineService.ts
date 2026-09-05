import { CorrespondenceEntry } from "../models/CorrespondenceEntry";
import { colorRules, colorSchema } from "./correspondences/types/colors";
import { crystalRules, crystalSchema } from "./correspondences/types/crystals";
import { essentialOilRules, essentialOilSchema } from "./correspondences/types/essentialOils";
import { flowerRules, flowerSchema } from "./correspondences/types/flowers";
import { herbRules, herbSchema } from "./correspondences/types/herbs";
import { sabbatRules, sabbatSchema } from "./correspondences/types/sabbats";
import { planetRules, planetSchema } from "./correspondences/types/planets";
import { zodiacSignRules, zodiacSignSchema } from "./correspondences/types/zodiacSigns";
import { lunarPhaseRules, lunarPhaseSchema } from "./correspondences/types/lunarPhases";
import { seasonRules, seasonSchema } from "./correspondences/types/seasons";
import { dayOfWeekRules, dayOfWeekSchema } from "./correspondences/types/daysOfWeek";
import { elementRules, elementSchema } from "./correspondences/types/elements";
import { tarotCardRules, tarotCardSchema } from "./correspondences/types/tarotCards";
import { deityRules, deitySchema } from "./correspondences/types/deities";
import { spiritRules, spiritSchema } from "./correspondences/types/spirits";
import { animalRules, animalSchema } from "./correspondences/types/animals";
import { toolRules, toolSchema } from "./correspondences/types/tools";
import { numberRules, numberSchema } from "./correspondences/types/numbers";

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
    ...(type === "sabbat" && {
      foods: stringArray(parsed.foods),
      drinks: stringArray(parsed.drinks),
      waysToCelebrate: stringArray(parsed.waysToCelebrate),
      ritualIdeas: stringArray(parsed.ritualIdeas),
      activities: stringArray(parsed.activities),
      decorations: stringArray(parsed.decorations),
      altarIdeas: stringArray(parsed.altarIdeas),
      herbsAndPlants: stringArray(parsed.herbsAndPlants),
      crystalsAndStones: stringArray(parsed.crystalsAndStones),
      incenseAndScents: stringArray(parsed.incenseAndScents),
      seasonalThemes: stringArray(parsed.seasonalThemes),
    }),
    ...(type === "herb" && {
      botanicalFamily: String(parsed.botanicalFamily ?? "").trim(),
      partsUsed: stringArray(parsed.partsUsed),
      preparationMethods: stringArray(parsed.preparationMethods),
      harvestingAndStorage: String(parsed.harvestingAndStorage ?? "").trim(),
      commonSubstitutions: stringArray(parsed.commonSubstitutions),
      complementaryHerbs: stringArray(parsed.complementaryHerbs),
      smokeAndIncenseUses: stringArray(parsed.smokeAndIncenseUses),
    }),
    ...(type === "flower" && {
      botanicalFamily: String(parsed.botanicalFamily ?? "").trim(),
      bloomingSeason: stringArray(parsed.bloomingSeason),
      partsUsed: stringArray(parsed.partsUsed),
      preservationMethods: stringArray(parsed.preservationMethods),
      floralSymbolism: stringArray(parsed.floralSymbolism),
      traditionalGiftMeanings: stringArray(parsed.traditionalGiftMeanings),
      complementaryFlowers: stringArray(parsed.complementaryFlowers),
      commonSubstitutions: stringArray(parsed.commonSubstitutions),
    }),
    ...(type === "crystal" && {
      mineralFamily: String(parsed.mineralFamily ?? "").trim(),
      composition: String(parsed.composition ?? "").trim(),
      hardness: String(parsed.hardness ?? "").trim(),
      crystalSystem: String(parsed.crystalSystem ?? "").trim(),
      commonColorsAndVarieties: stringArray(parsed.commonColorsAndVarieties),
      cleansingMethods: stringArray(parsed.cleansingMethods),
      chargingMethods: stringArray(parsed.chargingMethods),
      commonSubstitutions: stringArray(parsed.commonSubstitutions),
    }),
    ...(type === "essential_oil" && {
      sourcePlant: String(parsed.sourcePlant ?? "").trim(),
      plantPartUsed: String(parsed.plantPartUsed ?? "").trim(),
      aromaProfile: String(parsed.aromaProfile ?? "").trim(),
      blendingNotes: String(parsed.blendingNotes ?? "").trim(),
      complementaryOils: stringArray(parsed.complementaryOils),
      commonSubstitutions: stringArray(parsed.commonSubstitutions),
    }),
    ...(type === "color" && {
      shadesAndVariations: stringArray(parsed.shadesAndVariations),
      candleMagicUses: stringArray(parsed.candleMagicUses),
      visualizationUses: stringArray(parsed.visualizationUses),
    }),
    ...(type === "planet" && {
      planetaryDay: String(parsed.planetaryDay ?? "").trim(),
      planetaryHour: String(parsed.planetaryHour ?? "").trim(),
      traditionalMetal: String(parsed.traditionalMetal ?? "").trim(),
      associatedHerbs: stringArray(parsed.associatedHerbs),
      associatedCrystals: stringArray(parsed.associatedCrystals),
      magicalDomains: stringArray(parsed.magicalDomains),
    }),
    ...(type === "zodiac_sign" && {
      modality: String(parsed.modality ?? "").trim(),
      polarity: String(parsed.polarity ?? "").trim(),
      rulingPlanet: String(parsed.rulingPlanet ?? "").trim(),
      houseAssociation: String(parsed.houseAssociation ?? "").trim(),
      symbolMeaning: String(parsed.symbolMeaning ?? "").trim(),
      energeticQualities: stringArray(parsed.energeticQualities),
      strengthsAndWeaknesses: stringArray(parsed.strengthsAndWeaknesses),
      associatedHerbs: stringArray(parsed.associatedHerbs),
      associatedCrystals: stringArray(parsed.associatedCrystals),
    }),
    ...(type === "lunar_phase" && {
      energeticTheme: String(parsed.energeticTheme ?? "").trim(),
      bestMagicalWork: stringArray(parsed.bestMagicalWork),
      activities: stringArray(parsed.activities),
      associatedHerbs: stringArray(parsed.associatedHerbs),
      associatedCrystals: stringArray(parsed.associatedCrystals),
      altarIdeas: stringArray(parsed.altarIdeas),
    }),
    ...(type === "season" && {
      seasonalThemes: stringArray(parsed.seasonalThemes),
      seasonalFoods: stringArray(parsed.seasonalFoods),
      seasonalDrinks: stringArray(parsed.seasonalDrinks),
      seasonalPlants: stringArray(parsed.seasonalPlants),
      seasonalAnimals: stringArray(parsed.seasonalAnimals),
      seasonalActivities: stringArray(parsed.seasonalActivities),
      altarIdeas: stringArray(parsed.altarIdeas),
      decorations: stringArray(parsed.decorations),
    }),
    ...(type === "day_of_week" && {
      rulingPlanet: String(parsed.rulingPlanet ?? "").trim(),
      magicalFocus: stringArray(parsed.magicalFocus),
      associatedHerbs: stringArray(parsed.associatedHerbs),
      associatedCrystals: stringArray(parsed.associatedCrystals),
      associatedColors: stringArray(parsed.associatedColors),
      deityAssociations: stringArray(parsed.deityAssociations),
    }),
    ...(type === "element" && {
      direction: String(parsed.direction ?? "").trim(),
      qualities: stringArray(parsed.qualities),
      magicalDomains: stringArray(parsed.magicalDomains),
      associatedTools: stringArray(parsed.associatedTools),
      associatedHerbs: stringArray(parsed.associatedHerbs),
      associatedCrystals: stringArray(parsed.associatedCrystals),
      associatedSpirits: stringArray(parsed.associatedSpirits),
      associatedWeather: stringArray(parsed.associatedWeather),
      invocationMethods: stringArray(parsed.invocationMethods),
      altarRepresentation: String(parsed.altarRepresentation ?? "").trim(),
    }),
    ...(type === "tarot_card" && {
      arcana: String(parsed.arcana ?? "").trim(),
      suit: String(parsed.suit ?? "").trim(),
      numberOrRank: String(parsed.numberOrRank ?? "").trim(),
      element: String(parsed.element ?? "").trim(),
      astrologicalAssociation: String(parsed.astrologicalAssociation ?? "").trim(),
      uprightMeaning: String(parsed.uprightMeaning ?? "").trim(),
      reversedMeaning: String(parsed.reversedMeaning ?? "").trim(),
      keywords: stringArray(parsed.keywords),
      imageryAndSymbolism: String(parsed.imageryAndSymbolism ?? "").trim(),
      yesNoAssociation: String(parsed.yesNoAssociation ?? "").trim(),
      timingAssociation: String(parsed.timingAssociation ?? "").trim(),
    }),
    ...(type === "deity" && {
      cultureTradition: String(parsed.cultureTradition ?? "").trim(),
      pantheon: String(parsed.pantheon ?? "").trim(),
      domains: stringArray(parsed.domains),
      epithetsTitles: stringArray(parsed.epithetsTitles),
      sacredAnimals: stringArray(parsed.sacredAnimals),
      sacredPlants: stringArray(parsed.sacredPlants),
      sacredPlaces: stringArray(parsed.sacredPlaces),
      offerings: stringArray(parsed.offerings),
      devotionalActs: stringArray(parsed.devotionalActs),
      altarIdeas: stringArray(parsed.altarIdeas),
      festivalsHolyDays: stringArray(parsed.festivalsHolyDays),
      mythsAndStories: String(parsed.mythsAndStories ?? "").trim(),
      historicalWorship: String(parsed.historicalWorship ?? "").trim(),
      modernDevotionalPractices: stringArray(parsed.modernDevotionalPractices),
    }),
    ...(type === "spirit" && {
      spiritType: String(parsed.spiritType ?? "").trim(),
      culturalContext: String(parsed.culturalContext ?? "").trim(),
      domainsAssociations: stringArray(parsed.domainsAssociations),
      appearanceDescriptions: String(parsed.appearanceDescriptions ?? "").trim(),
      signsAndPresence: stringArray(parsed.signsAndPresence),
      offerings: stringArray(parsed.offerings),
      communicationMethods: stringArray(parsed.communicationMethods),
      altarIdeas: stringArray(parsed.altarIdeas),
      relatedSpirits: stringArray(parsed.relatedSpirits),
      protectiveConsiderations: String(parsed.protectiveConsiderations ?? "").trim(),
    }),
    ...(type === "animal" && {
      habitat: String(parsed.habitat ?? "").trim(),
      behavioralTraits: stringArray(parsed.behavioralTraits),
      symbolicTraits: stringArray(parsed.symbolicTraits),
      omensAndSigns: stringArray(parsed.omensAndSigns),
      dreamMeaning: String(parsed.dreamMeaning ?? "").trim(),
      encounterMeaning: String(parsed.encounterMeaning ?? "").trim(),
      associatedSeasons: stringArray(parsed.associatedSeasons),
      spiritGuideInterpretations: String(parsed.spiritGuideInterpretations ?? "").trim(),
      culturalSymbolism: String(parsed.culturalSymbolism ?? "").trim(),
    }),
    ...(type === "tool" && {
      toolType: String(parsed.toolType ?? "").trim(),
      traditionalPurpose: String(parsed.traditionalPurpose ?? "").trim(),
      howToUse: String(parsed.howToUse ?? "").trim(),
      preparation: String(parsed.preparation ?? "").trim(),
      cleansing: String(parsed.cleansing ?? "").trim(),
      consecration: String(parsed.consecration ?? "").trim(),
      charging: String(parsed.charging ?? "").trim(),
      storage: String(parsed.storage ?? "").trim(),
      materials: stringArray(parsed.materials),
      commonVariations: stringArray(parsed.commonVariations),
      substitutions: stringArray(parsed.substitutions),
      ritualApplications: stringArray(parsed.ritualApplications),
      spellworkApplications: stringArray(parsed.spellworkApplications),
    }),
    ...(type === "number" && {
      coreMeaning: String(parsed.coreMeaning ?? "").trim(),
      positiveExpression: String(parsed.positiveExpression ?? "").trim(),
      shadowExpression: String(parsed.shadowExpression ?? "").trim(),
      repeatingNumberMeaning: String(parsed.repeatingNumberMeaning ?? "").trim(),
      synchronicityMeaning: String(parsed.synchronicityMeaning ?? "").trim(),
      manifestationAssociation: String(parsed.manifestationAssociation ?? "").trim(),
      divinationMeaning: String(parsed.divinationMeaning ?? "").trim(),
      tarotConnections: stringArray(parsed.tarotConnections),
      astrologicalConnections: stringArray(parsed.astrologicalConnections),
      sacredGeometrySymbolism: String(parsed.sacredGeometrySymbolism ?? "").trim(),
      culturalHistoricalMeanings: stringArray(parsed.culturalHistoricalMeanings),
    }),
  };
}

function buildPrompt(type: CorrespondenceType, name: string): string {
  const typeSpecificSchema =
    type === "sabbat" ? sabbatSchema :
    type === "herb" ? herbSchema :
    type === "flower" ? flowerSchema :
    type === "crystal" ? crystalSchema :
    type === "essential_oil" ? essentialOilSchema :
    type === "color" ? colorSchema :
    type === "planet" ? planetSchema :
    type === "zodiac_sign" ? zodiacSignSchema :
    type === "lunar_phase" ? lunarPhaseSchema :
    type === "season" ? seasonSchema :
    type === "day_of_week" ? dayOfWeekSchema :
    type === "element" ? elementSchema :
    type === "tarot_card" ? tarotCardSchema :
    type === "deity" ? deitySchema :
    type === "spirit" ? spiritSchema :
    type === "animal" ? animalSchema :
    type === "tool" ? toolSchema :
    type === "number" ? numberSchema :
    "";
  const typeSpecificRules =
    type === "sabbat" ? sabbatRules :
    type === "herb" ? herbRules :
    type === "flower" ? flowerRules :
    type === "crystal" ? crystalRules :
    type === "essential_oil" ? essentialOilRules :
    type === "color" ? colorRules :
    type === "planet" ? planetRules :
    type === "zodiac_sign" ? zodiacSignRules :
    type === "lunar_phase" ? lunarPhaseRules :
    type === "season" ? seasonRules :
    type === "day_of_week" ? dayOfWeekRules :
    type === "element" ? elementRules :
    type === "tarot_card" ? tarotCardRules :
    type === "deity" ? deityRules :
    type === "spirit" ? spiritRules :
    type === "animal" ? animalRules :
    type === "tool" ? toolRules :
    type === "number" ? numberRules :
    "";

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
  "warnings": "safety, toxicity, contraindications, ethical harvesting, or handling precautions, or empty string"${typeSpecificSchema}
}

Rules:
- Be historically accurate where possible.
- Distinguish historical correspondences from modern Wiccan, New Age, or modern occult correspondences when they differ.
- Do not fabricate associations simply to complete every field.
- If information is uncertain, disputed, sparse, or varies between traditions, say that in the relevant field.
- Do not give medical, legal, or financial advice.
- Warnings must be practical and safety-focused when relevant.${typeSpecificRules}
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
    ...(doc.type === "sabbat" && {
      foods: doc.foods ?? [],
      drinks: doc.drinks ?? [],
      waysToCelebrate: doc.waysToCelebrate ?? [],
      ritualIdeas: doc.ritualIdeas ?? [],
      activities: doc.activities ?? [],
      decorations: doc.decorations ?? [],
      altarIdeas: doc.altarIdeas ?? [],
      herbsAndPlants: doc.herbsAndPlants ?? [],
      crystalsAndStones: doc.crystalsAndStones ?? [],
      incenseAndScents: doc.incenseAndScents ?? [],
      seasonalThemes: doc.seasonalThemes ?? [],
    }),
    ...(doc.type === "herb" && {
      botanicalFamily: doc.botanicalFamily ?? "",
      partsUsed: doc.partsUsed ?? [],
      preparationMethods: doc.preparationMethods ?? [],
      harvestingAndStorage: doc.harvestingAndStorage ?? "",
      commonSubstitutions: doc.commonSubstitutions ?? [],
      complementaryHerbs: doc.complementaryHerbs ?? [],
      smokeAndIncenseUses: doc.smokeAndIncenseUses ?? [],
    }),
    ...(doc.type === "flower" && {
      botanicalFamily: doc.botanicalFamily ?? "",
      bloomingSeason: doc.bloomingSeason ?? [],
      partsUsed: doc.partsUsed ?? [],
      preservationMethods: doc.preservationMethods ?? [],
      floralSymbolism: doc.floralSymbolism ?? [],
      traditionalGiftMeanings: doc.traditionalGiftMeanings ?? [],
      complementaryFlowers: doc.complementaryFlowers ?? [],
      commonSubstitutions: doc.commonSubstitutions ?? [],
    }),
    ...(doc.type === "crystal" && {
      mineralFamily: doc.mineralFamily ?? "",
      composition: doc.composition ?? "",
      hardness: doc.hardness ?? "",
      crystalSystem: doc.crystalSystem ?? "",
      commonColorsAndVarieties: doc.commonColorsAndVarieties ?? [],
      cleansingMethods: doc.cleansingMethods ?? [],
      chargingMethods: doc.chargingMethods ?? [],
      commonSubstitutions: doc.commonSubstitutions ?? [],
    }),
    ...(doc.type === "essential_oil" && {
      sourcePlant: doc.sourcePlant ?? "",
      plantPartUsed: doc.plantPartUsed ?? "",
      aromaProfile: doc.aromaProfile ?? "",
      blendingNotes: doc.blendingNotes ?? "",
      complementaryOils: doc.complementaryOils ?? [],
      commonSubstitutions: doc.commonSubstitutions ?? [],
    }),
    ...(doc.type === "color" && {
      shadesAndVariations: doc.shadesAndVariations ?? [],
      candleMagicUses: doc.candleMagicUses ?? [],
      visualizationUses: doc.visualizationUses ?? [],
    }),
    ...(doc.type === "planet" && {
      planetaryDay: doc.planetaryDay ?? "",
      planetaryHour: doc.planetaryHour ?? "",
      traditionalMetal: doc.traditionalMetal ?? "",
      associatedHerbs: doc.associatedHerbs ?? [],
      associatedCrystals: doc.associatedCrystals ?? [],
      magicalDomains: doc.magicalDomains ?? [],
    }),
    ...(doc.type === "zodiac_sign" && {
      modality: doc.modality ?? "",
      polarity: doc.polarity ?? "",
      rulingPlanet: doc.rulingPlanet ?? "",
      houseAssociation: doc.houseAssociation ?? "",
      symbolMeaning: doc.symbolMeaning ?? "",
      energeticQualities: doc.energeticQualities ?? [],
      strengthsAndWeaknesses: doc.strengthsAndWeaknesses ?? [],
      associatedHerbs: doc.associatedHerbs ?? [],
      associatedCrystals: doc.associatedCrystals ?? [],
    }),
    ...(doc.type === "lunar_phase" && {
      energeticTheme: doc.energeticTheme ?? "",
      bestMagicalWork: doc.bestMagicalWork ?? [],
      activities: doc.activities ?? [],
      associatedHerbs: doc.associatedHerbs ?? [],
      associatedCrystals: doc.associatedCrystals ?? [],
      altarIdeas: doc.altarIdeas ?? [],
    }),
    ...(doc.type === "season" && {
      seasonalThemes: doc.seasonalThemes ?? [],
      seasonalFoods: doc.seasonalFoods ?? [],
      seasonalDrinks: doc.seasonalDrinks ?? [],
      seasonalPlants: doc.seasonalPlants ?? [],
      seasonalAnimals: doc.seasonalAnimals ?? [],
      seasonalActivities: doc.seasonalActivities ?? [],
      altarIdeas: doc.altarIdeas ?? [],
      decorations: doc.decorations ?? [],
    }),
    ...(doc.type === "day_of_week" && {
      rulingPlanet: doc.rulingPlanet ?? "",
      magicalFocus: doc.magicalFocus ?? [],
      associatedHerbs: doc.associatedHerbs ?? [],
      associatedCrystals: doc.associatedCrystals ?? [],
      associatedColors: doc.associatedColors ?? [],
      deityAssociations: doc.deityAssociations ?? [],
    }),
    ...(doc.type === "element" && {
      direction: doc.direction ?? "",
      qualities: doc.qualities ?? [],
      magicalDomains: doc.magicalDomains ?? [],
      associatedTools: doc.associatedTools ?? [],
      associatedHerbs: doc.associatedHerbs ?? [],
      associatedCrystals: doc.associatedCrystals ?? [],
      associatedSpirits: doc.associatedSpirits ?? [],
      associatedWeather: doc.associatedWeather ?? [],
      invocationMethods: doc.invocationMethods ?? [],
      altarRepresentation: doc.altarRepresentation ?? "",
    }),
    ...(doc.type === "tarot_card" && {
      arcana: doc.arcana ?? "",
      suit: doc.suit ?? "",
      numberOrRank: doc.numberOrRank ?? "",
      element: doc.element ?? "",
      astrologicalAssociation: doc.astrologicalAssociation ?? "",
      uprightMeaning: doc.uprightMeaning ?? "",
      reversedMeaning: doc.reversedMeaning ?? "",
      keywords: doc.keywords ?? [],
      imageryAndSymbolism: doc.imageryAndSymbolism ?? "",
      yesNoAssociation: doc.yesNoAssociation ?? "",
      timingAssociation: doc.timingAssociation ?? "",
    }),
    ...(doc.type === "deity" && {
      cultureTradition: doc.cultureTradition ?? "",
      pantheon: doc.pantheon ?? "",
      domains: doc.domains ?? [],
      epithetsTitles: doc.epithetsTitles ?? [],
      sacredAnimals: doc.sacredAnimals ?? [],
      sacredPlants: doc.sacredPlants ?? [],
      sacredPlaces: doc.sacredPlaces ?? [],
      offerings: doc.offerings ?? [],
      devotionalActs: doc.devotionalActs ?? [],
      altarIdeas: doc.altarIdeas ?? [],
      festivalsHolyDays: doc.festivalsHolyDays ?? [],
      mythsAndStories: doc.mythsAndStories ?? "",
      historicalWorship: doc.historicalWorship ?? "",
      modernDevotionalPractices: doc.modernDevotionalPractices ?? [],
    }),
    ...(doc.type === "spirit" && {
      spiritType: doc.spiritType ?? "",
      culturalContext: doc.culturalContext ?? "",
      domainsAssociations: doc.domainsAssociations ?? [],
      appearanceDescriptions: doc.appearanceDescriptions ?? "",
      signsAndPresence: doc.signsAndPresence ?? [],
      offerings: doc.offerings ?? [],
      communicationMethods: doc.communicationMethods ?? [],
      altarIdeas: doc.altarIdeas ?? [],
      relatedSpirits: doc.relatedSpirits ?? [],
      protectiveConsiderations: doc.protectiveConsiderations ?? "",
    }),
    ...(doc.type === "animal" && {
      habitat: doc.habitat ?? "",
      behavioralTraits: doc.behavioralTraits ?? [],
      symbolicTraits: doc.symbolicTraits ?? [],
      omensAndSigns: doc.omensAndSigns ?? [],
      dreamMeaning: doc.dreamMeaning ?? "",
      encounterMeaning: doc.encounterMeaning ?? "",
      associatedSeasons: doc.associatedSeasons ?? [],
      spiritGuideInterpretations: doc.spiritGuideInterpretations ?? "",
      culturalSymbolism: doc.culturalSymbolism ?? "",
    }),
    ...(doc.type === "tool" && {
      toolType: doc.toolType ?? "",
      traditionalPurpose: doc.traditionalPurpose ?? "",
      howToUse: doc.howToUse ?? "",
      preparation: doc.preparation ?? "",
      cleansing: doc.cleansing ?? "",
      consecration: doc.consecration ?? "",
      charging: doc.charging ?? "",
      storage: doc.storage ?? "",
      materials: doc.materials ?? [],
      commonVariations: doc.commonVariations ?? [],
      substitutions: doc.substitutions ?? [],
      ritualApplications: doc.ritualApplications ?? [],
      spellworkApplications: doc.spellworkApplications ?? [],
    }),
    ...(doc.type === "number" && {
      coreMeaning: doc.coreMeaning ?? "",
      positiveExpression: doc.positiveExpression ?? "",
      shadowExpression: doc.shadowExpression ?? "",
      repeatingNumberMeaning: doc.repeatingNumberMeaning ?? "",
      synchronicityMeaning: doc.synchronicityMeaning ?? "",
      manifestationAssociation: doc.manifestationAssociation ?? "",
      divinationMeaning: doc.divinationMeaning ?? "",
      tarotConnections: doc.tarotConnections ?? [],
      astrologicalConnections: doc.astrologicalConnections ?? [],
      sacredGeometrySymbolism: doc.sacredGeometrySymbolism ?? "",
      culturalHistoricalMeanings: doc.culturalHistoricalMeanings ?? [],
    }),
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
