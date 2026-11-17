import type { DiscoveryPromptCollection } from "../discoveryTypes";

/**
 * Intellectual & Academic — precise vocabulary for ideas, reasoning,
 * argumentation, interpretation, and scholarly communication.
 */
export const intellectualAndAcademicPrompts: DiscoveryPromptCollection = {
  accessible: `
Discover useful English words for expressing ideas, analyzing information,
and participating in thoughtful conversations or introductory academic writing.

Difficulty: ACCESSIBLE. Choose intellectually meaningful words that a curious
adult can learn and apply without specialized training. Favor vocabulary that
clarifies distinctions, supports careful reasoning, describes evidence,
expresses uncertainty, or helps explain a position. Words may be familiar
from essays, nonfiction, and classroom discussions but should offer more
precision than everyday general-purpose language.

Include a healthy mix of nouns, verbs, and adjectives. Explore concepts such
as assumptions, patterns, perspectives, interpretation, consequences,
consistency, and practical judgment. Each candidate should have a clear
role in discussing ideas, not merely sound formal.

Avoid elementary terms such as think, idea, smart, know, and learn. Exclude
specialized mathematical notation, discipline-specific jargon, intimidating
philosophical terminology, and rare words chosen only for their length.
Do not turn this category into a list of generic business buzzwords.
`.trim(),

  elevated: `
Discover sophisticated English vocabulary for rigorous thinking, nuanced
argument, critical interpretation, and articulate academic discussion.

Difficulty: ELEVATED. Select words that appear naturally in serious
nonfiction, scholarly essays, criticism, philosophy-adjacent discussion,
and advanced general education. A well-read adult may recognize these
terms without being fully confident about their precise meanings.
Favor concepts that distinguish kinds of reasoning, relationships between
ideas, interpretive positions, logical tensions, and qualities of evidence.

Seek intellectual usefulness and semantic precision rather than mere
formality. Include nouns, verbs, and adjectives across epistemology,
rhetoric, analysis, methodology, and conceptual debate, while keeping
the words applicable beyond one narrow academic discipline.

Exclude basic classroom vocabulary, fashionable corporate jargon,
unnecessary Latin phrases, and obscure specialist terminology that
requires extensive background knowledge. Avoid producing a parade of
near-synonyms for intelligent, logical, or complicated. Every word
must be a genuine English dictionary headword.
`.trim(),

  exceptional: `
Discover rare, exacting, dictionary-attested English vocabulary for advanced
intellectual inquiry, conceptual distinctions, philosophical argument,
and unusually precise scholarly expression.

Difficulty: EXCEPTIONAL. Favor terms that even well-read adults may not
know but that carry an established, defensible meaning in serious writing.
Candidates may originate in philosophy, logic, rhetoric, historiography,
or intellectual history when their meanings can be explained as standalone
English vocabulary. Seek words that identify a subtle reasoning error,
an unusual relationship between concepts, a specialized interpretive
stance, or a precise mode of inquiry.

Maintain genuine conceptual depth. Include varied parts of speech and
different intellectual traditions, rather than focusing exclusively on
logical fallacies or Greek-derived nouns. Rarity must serve clarity
and discovery; do not reward extreme length, opaque spelling, or
terminological novelty for its own sake.

Exclude invented philosophical jargon, proper names, unexplained acronyms,
mathematical symbols, non-English phrases without established English
headword status, and hyper-specialized terms whose meanings depend on
one research subfield. Avoid repetitive lists of famous obscure words.
`.trim(),
};
