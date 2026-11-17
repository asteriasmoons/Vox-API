import { discoveryCategories } from "./discoveryCategories";
import {
  isDiscoveryCategory,
  isDiscoveryDifficulty,
  type DiscoveryCategory,
  type DiscoveryDifficulty,
} from "./discoveryTypes";

/**
 * Selects the unique category + difficulty editorial brief.
 * Rejects invalid API inputs instead of silently selecting another prompt.
 */
export function selectDiscoveryPrompt(
  category: DiscoveryCategory,
  difficulty: DiscoveryDifficulty,
): string {
  if (!isDiscoveryCategory(category)) {
    throw new RangeError("Invalid word discovery category");
  }

  if (!isDiscoveryDifficulty(difficulty)) {
    throw new RangeError("Invalid word discovery difficulty");
  }

  return discoveryCategories[category][difficulty];
}
