import type { DiscoveryPromptCollection } from "../discoveryTypes";

/**
 * Science & Discovery — authentic vocabulary for scientific concepts,
 * processes, phenomena, and the methods by which we understand the world.
 */
export const scienceAndDiscoveryPrompts: DiscoveryPromptCollection = {
  accessible: `
Discover fascinating, approachable English scientific vocabulary that helps
curious adults understand the natural world, technology, and how discoveries
are made.

Difficulty: ACCESSIBLE. Choose established scientific words that appear in
popular science writing, documentaries, museums, and general educational
materials. A learner without specialist training should be able to grasp
each word through a concise explanation and connect it to an observable
phenomenon, useful concept, or recognizable scientific process.

Explore biology, astronomy, chemistry, physics, Earth science, ecology,
and scientific investigation. Include a varied mix of nouns, verbs,
and adjectives when appropriate. Favor precise concepts with clear
real-world relevance rather than words selected for impressive length.

Exclude elementary words such as science, planet, animal, energy, and
experiment when they add little discovery value. Avoid mathematical
notation, Latin species names, unexplained abbreviations, highly
technical laboratory procedures, and terms that require advanced
prerequisite knowledge. Do not invent discoveries or scientific claims.
`.trim(),

  elevated: `
Discover sophisticated, authentic English vocabulary that reveals
interesting scientific phenomena, mechanisms, relationships, and
methods of inquiry.

Difficulty: ELEVATED. Select terms a well-read adult might encounter
in high-quality popular science, advanced nonfiction, or introductory
university material without fully understanding their precise meanings.
Favor words that illuminate how something works or name a meaningful
pattern, process, property, or scientific distinction. Technical terms
are welcome when their definitions can be understood independently
without a lengthy specialist explanation.

Draw broadly from life sciences, physical sciences, astronomy, geology,
ecology, and the practice of research. Balance processes, properties,
structures, and phenomena; do not focus only on spectacular cosmic
objects or biological terminology. Include different grammatical
forms where natural to scientific English.

Exclude basic schoolbook vocabulary, arbitrary taxonomic labels,
obscure equipment names, formulas, acronyms without established
word status, and jargon meaningful only within one narrow research
specialty. Require established scientific usage and avoid
sensationalized or scientifically unsupported claims.
`.trim(),

  exceptional: `
Discover genuinely rare, advanced, dictionary-attested English
scientific vocabulary describing remarkable phenomena, subtle
mechanisms, unusual properties, or precise scientific concepts.

Difficulty: EXCEPTIONAL. Seek terms that even scientifically curious,
widely read adults may not recognize. This category explicitly permits
specialized scientific terminology when the word has an established
meaning, represents a coherent concept, and can be explained accurately
without relying on a chain of unexplained jargon. Rarity must reward
curiosity by teaching something substantive about the world.

Explore surprising concepts across physics, chemistry, biology,
astronomy, Earth systems, and scientific methodology. Prefer
independently meaningful terms for processes, interactions, states,
or phenomena rather than random names of instruments, organisms,
or subfields. Vary disciplines and parts of speech when possible.

Exclude invented terminology, speculative phenomena presented as
established facts, Latin binomials, proprietary product names,
arbitrary abbreviations, equations, and terms so narrowly defined
that no reliable general explanation is possible. Avoid merely
selecting the longest or most intimidating scientific words.
`.trim(),
};
