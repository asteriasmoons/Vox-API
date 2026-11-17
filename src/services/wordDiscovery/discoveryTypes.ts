/**
 * Shared vocabulary discovery identifiers.
 * Category controls subject and style; difficulty controls accessibility.
 */
export const DISCOVERY_CATEGORIES = [
  "beautifulWords",
  "emotionsAndFeelings",
  "literaryAndPoetic",
  "intellectualAndAcademic",
  "expressiveVocabulary",
  "historicalAndArchaic",
  "natureAndTheWorld",
  "mysticalAndPhilosophical",
  "scienceAndDiscovery",
  "personalityAndBehavior",
] as const;

export const DISCOVERY_DIFFICULTIES = [
  "accessible",
  "elevated",
  "exceptional",
] as const;

export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number];
export type DiscoveryDifficulty = (typeof DISCOVERY_DIFFICULTIES)[number];
export type DiscoveryPromptCollection = Record<DiscoveryDifficulty, string>;

export function isDiscoveryCategory(
  value: unknown,
): value is DiscoveryCategory {
  return (
    typeof value === "string" &&
    (DISCOVERY_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isDiscoveryDifficulty(
  value: unknown,
): value is DiscoveryDifficulty {
  return (
    typeof value === "string" &&
    (DISCOVERY_DIFFICULTIES as readonly string[]).includes(value)
  );
}
