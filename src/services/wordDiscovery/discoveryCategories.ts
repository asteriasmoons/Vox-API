import type {
  DiscoveryCategory,
  DiscoveryPromptCollection,
} from "./discoveryTypes";
import { beautifulWordsPrompts } from "./categories/beautifulWords";
import { emotionsAndFeelingsPrompts } from "./categories/emotionsAndFeelings";
import { literaryAndPoeticPrompts } from "./categories/literaryAndPoetic";
import { intellectualAndAcademicPrompts } from "./categories/intellectualAndAcademic";
import { expressiveVocabularyPrompts } from "./categories/expressiveVocabulary";
import { historicalAndArchaicPrompts } from "./categories/historicalAndArchaic";
import { natureAndTheWorldPrompts } from "./categories/natureAndTheWorld";
import { mysticalAndPhilosophicalPrompts } from "./categories/mysticalAndPhilosophical";
import { scienceAndDiscoveryPrompts } from "./categories/scienceAndDiscovery";
import { personalityAndBehaviorPrompts } from "./categories/personalityAndBehavior";

/**
 * Central registry for the 10 discovery categories and their 30 prompts.
 * TypeScript requires each category to have all three difficulty prompts.
 */
export const discoveryCategories: Record<
  DiscoveryCategory,
  DiscoveryPromptCollection
> = {
  beautifulWords: beautifulWordsPrompts,
  emotionsAndFeelings: emotionsAndFeelingsPrompts,
  literaryAndPoetic: literaryAndPoeticPrompts,
  intellectualAndAcademic: intellectualAndAcademicPrompts,
  expressiveVocabulary: expressiveVocabularyPrompts,
  historicalAndArchaic: historicalAndArchaicPrompts,
  natureAndTheWorld: natureAndTheWorldPrompts,
  mysticalAndPhilosophical: mysticalAndPhilosophicalPrompts,
  scienceAndDiscovery: scienceAndDiscoveryPrompts,
  personalityAndBehavior: personalityAndBehaviorPrompts,
};
