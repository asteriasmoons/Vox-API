import type { DiscoveryPromptCollection } from "../discoveryTypes";

/**
 * Emotions & Feelings: nuanced vocabulary for inner experiences, moods,
 * emotional reactions, and interpersonal feelings.
 */
export const emotionsAndFeelingsPrompts: DiscoveryPromptCollection = {
  accessible: `
Find expressive English words that help an adult name feelings, moods, attitudes,
and interpersonal experiences with more precision than everyday emotion labels.

Difficulty: ACCESSIBLE. Select approachable, useful words that are somewhat
richer than basic speech but not difficult to understand or pronounce. A
curious reader should be able to use these words in a journal, a thoughtful
conversation, or a personal letter after learning their meanings.

Favor emotional shades such as quiet longing, conflicted feelings, tenderness,
unease, hope, disappointment, reassurance, and subtle shifts in mood. Include
adjectives, nouns, and verbs where appropriate. Choose words with established
meanings and natural usage, not merely dramatic-sounding labels.

Exclude elementary words such as happy, sad, angry, scared, love, and excited.
Avoid psychiatric diagnoses, therapy jargon, obscure academic constructs,
specialist neuroscience terminology, and excessively archaic expressions.
Do not confuse difficulty with emotional intensity: accessible words can
describe complex experiences in clear language.
`.trim(),

  elevated: `
Find sophisticated, emotionally precise English vocabulary for the subtle,
sometimes contradictory experiences of human feeling and relationships.

Difficulty: ELEVATED. Favor less familiar but genuinely useful words that
appear in thoughtful fiction, essays, criticism, memoir, or articulate
conversation. The words should distinguish feelings that ordinary labels
flatten together: mixed affection and resentment, restrained sorrow,
anticipatory dread, yearning, alienation, bittersweet remembrance, or
an unexpected sense of peace.

Prioritize nuance and specificity over length. Draw from moods, emotional
dispositions, fleeting reactions, and social or interpersonal experiences.
Include a variety of parts of speech and emotional tones, not just sorrow
or romantic longing. Each candidate must be a real, dictionary-recognized
English headword with a defensible emotional meaning.

Exclude basic feeling words, generic personality traits without emotional
relevance, diagnostic labels, and specialized clinical terminology. Avoid
words so obscure that a well-read adult would almost never encounter them
outside a specialist lexicon. Do not pad results with near-synonyms of
the same emotional state.
`.trim(),

  exceptional: `
Find rare, distinctive, dictionary-attested English words that illuminate
unusually specific, elusive, or layered emotional experiences.

Difficulty: EXCEPTIONAL. Seek vocabulary that a widely read adult may not
know, including uncommon literary terms, historically attested emotional
expressions, and precise words for subtle inner states or interpersonal
tensions. The rarity should serve expressive discovery: a word should
reveal a meaningful emotional distinction, not merely sound impressive.

Explore complex feelings such as yearning mixed with regret, affection
shadowed by fear, estrangement, inward agitation, bittersweet recognition,
emotional numbness, quiet exultation, or conflicting loyalties. These are
inspirations for semantic range, not requirements to invent a label for
every experience. Vary parts of speech, emotional valence, and cultural
or historical registers while keeping the vocabulary authentically English.

Avoid fabricated internet emotion words, unsupported 'untranslatable'
borrowings, clinical diagnoses, psychiatric jargon, and invented compounds.
Do not use rare scientific terminology unless it is an established word
for a subjective emotional experience. Prefer words with reliable dictionary
entries over viral lists of allegedly poetic vocabulary.
`.trim(),
};
