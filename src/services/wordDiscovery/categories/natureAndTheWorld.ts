import type { DiscoveryPromptCollection } from "../discoveryTypes";

/**
 * Nature & The World — vocabulary for landscapes, living things,
 * weather, environments, and observable natural phenomena.
 */
export const natureAndTheWorldPrompts: DiscoveryPromptCollection = {
  accessible: `
Discover expressive, approachable English words for describing nature,
weather, landscapes, plants, animals, and the physical world around us.

Difficulty: ACCESSIBLE. Select established words that a curious adult can
understand and use when talking about a walk, describing a place, writing
about a season, or noticing details outdoors. Favor vocabulary that is more
specific or evocative than everyday labels but does not require scientific
training. Words should be practical enough to recognize in nature writing,
travel writing, or thoughtful conversation.

Explore varied natural settings: forests, coastlines, mountains, gardens,
skies, waterways, wildlife, and changing weather. Include nouns, verbs,
and adjectives. Choose words that name real features, movements, textures,
conditions, or relationships in the natural world.

Avoid elementary words such as tree, rain, flower, sunny, and animal.
Exclude Latin species names, obscure geological classifications, dense
biological jargon, invented nature words, and words whose only connection
to nature is a distant metaphor. Do not focus exclusively on pleasant
scenery or floral descriptions.
`.trim(),

  elevated: `
Discover distinctive English vocabulary for observing and describing
natural environments, ecological relationships, atmospheric conditions,
and the textures and movements of the physical world.

Difficulty: ELEVATED. Favor less familiar but well-established words that
appear in sophisticated nature writing, environmental essays, field guides,
or literary descriptions of place. A well-read adult might recognize a
candidate without knowing its precise meaning. Prioritize specificity:
words should identify a recognizable natural quality, process, setting,
organism-related characteristic, or environmental phenomenon.

Draw from weather, landforms, water, light, vegetation, animal behavior,
seasons, and ecological patterns. Include a balance of nouns, verbs,
and adjectives. Scientific-origin words are welcome when they have a
clear, intelligible meaning and are useful beyond narrow specialist work.

Avoid basic scenery words, arbitrary species names, opaque taxonomic
terminology, highly specialized laboratory vocabulary, and fanciful
internet coinages. Do not produce only poetic adjectives or only
meteorological terms. Seek variety in scale, habitat, and sensory quality.
`.trim(),

  exceptional: `
Discover rare, authentic English words that name unusual natural phenomena,
specific environmental conditions, distinctive biological behaviors,
or remarkable features of the physical world.

Difficulty: EXCEPTIONAL. Seek vocabulary that even widely read nature
enthusiasts may not know, while requiring genuine dictionary-attested
English usage. Appropriate candidates may come from natural history,
meteorology, geology, ecology, botany, or zoology when they describe a
coherent, explainable phenomenon or quality rather than a cryptic
classification. Rarity should reveal something fascinating about nature.

Explore overlooked phenomena across air, water, earth, living organisms,
light, sound, seasonal change, and interactions between environments.
Vary grammatical forms and subject areas. Prefer words whose meanings
can be explained independently and whose discovery adds a genuinely
new way to notice or understand the world.

Exclude fabricated terms, unverified viral nature vocabulary, Latin
binomials, random taxonomic ranks, highly localized proper names,
and technical abbreviations. Avoid obscure specialist terminology
whose meaning cannot be understood without advanced disciplinary
knowledge. Do not repeatedly recycle a handful of famous rare
nature words.
`.trim(),
};
