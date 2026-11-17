import type { DiscoveryPromptCollection } from "../discoveryTypes";

/**
 * Personality & Behavior — vocabulary for character traits, habits,
 * motivations, social conduct, and patterns of human behavior.
 */
export const personalityAndBehaviorPrompts: DiscoveryPromptCollection = {
  accessible: `
Discover expressive English vocabulary for describing people's personalities,
attitudes, habits, motivations, and ways of interacting with others.

Difficulty: ACCESSIBLE. Choose established, approachable words that help a
curious adult describe a person's conduct more precisely than generic labels.
Favor words usable in everyday conversation, journaling, character descriptions,
and thoughtful discussions of relationships. Each candidate should identify
a recognizable trait or behavior without requiring specialist knowledge.

Explore kindness, stubbornness, sociability, reliability, curiosity, restraint,
confidence, adaptability, and interpersonal conduct, without limiting the
results to these examples. Include adjectives, nouns, and verbs where natural.
Balance admirable, difficult, and neutral qualities rather than judging every
trait as inherently good or bad.

Avoid elementary words such as nice, mean, shy, rude, good, and bad. Exclude
psychiatric diagnoses, clinical personality classifications, invented labels,
internet stereotypes, and terms that describe temporary emotions without a
clear behavioral or personality connection. Favor specificity over drama.
`.trim(),

  elevated: `
Discover sophisticated English vocabulary for nuanced personality traits,
behavioral tendencies, motivations, social dynamics, and patterns of conduct.

Difficulty: ELEVATED. Select established words that a well-read adult might
encounter in literary characterization, thoughtful essays, biography, or
articulate conversation without fully knowing their meanings. Favor terms
that distinguish closely related qualities: confidence from arrogance,
reserve from indifference, persistence from obstinacy, or charm from
manipulation. Each candidate should add a meaningful descriptive distinction.

Explore dispositions, interpersonal habits, reactions to pressure, moral
character, social behavior, and distinctive styles of thinking or acting.
Include varied parts of speech and a balance of positive, negative, and
context-dependent traits. Prioritize precise, recognizable behavior rather
than vague psychological speculation.

Avoid basic labels, diagnostic terminology, pop-psychology buzzwords,
unverified personality typologies, and words that are sophisticated only
because they are long. Do not produce near-synonym clusters for stubborn,
intelligent, or outgoing. Every candidate must be a genuine English word
with an established meaning.
`.trim(),

  exceptional: `
Discover rare, precise, dictionary-attested English vocabulary describing
unusual personality traits, distinctive behavioral patterns, social
conduct, and subtle human motivations.

Difficulty: EXCEPTIONAL. Seek words that even widely read adults may not
recognize but that capture a defensible and interesting distinction in
how people habitually think, act, respond, or relate to others. Candidates
may have literary or historical usage when they remain legitimate English
headwords with clear meanings. Rarity must reward understanding of human
character, not merely showcase unusual spelling or length.

Explore uncommon dispositions, interpersonal strategies, moral attitudes,
contradictory tendencies, styles of argument, habits of judgment, and
responses to authority or uncertainty. Include nouns, adjectives, and
verbs when appropriate. Seek variety in social context, emotional tone,
and whether a quality is admirable, troublesome, or ambiguous.

Exclude invented personality labels, psychiatric diagnoses, speculative
clinical claims, unverified internet terminology, and obscure technical
constructs that cannot be explained independently. Avoid equating
personality traits with medical conditions or presenting a descriptive
word as a diagnosis. Do not recycle a fixed list of famous obscure
character adjectives.
`.trim(),
};
