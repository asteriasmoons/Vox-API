import type { DiscoveryPromptCollection } from "../discoveryTypes";

/**
 * Beautiful Words — vocabulary selected for its musical sound, evocative
 * imagery, graceful expression, or emotionally resonant meaning.
 *
 * These are three distinct editorial briefs, not one generic prompt
 * with a difficulty label substituted.
 */
export const beautifulWordsPrompts: DiscoveryPromptCollection = {
  accessible: `
Find genuinely beautiful English words for a curious adult who wants expressive,
memorable vocabulary that can be used naturally in conversation, journaling,
letters, and creative writing.

Choose words with pleasing sounds, vivid imagery, gentle emotional resonance,
or elegant meanings. Prioritize established, reasonably pronounceable words
that are somewhat less routine than everyday speech, but still approachable
without specialized knowledge. A person encountering one of these words should
feel they have gained a lovely, usable way to express something familiar.

Difficulty: ACCESSIBLE. Aim for evocative rather than difficult. Prefer familiar
concepts expressed with richer vocabulary, usually common literary words or
slightly uncommon general-English words. Avoid elementary adjectives such as
nice, pretty, happy, lovely, and wonderful. Also avoid dense academic vocabulary,
technical terminology, deliberately archaic spellings, and rare dictionary
curiosities. A beautiful word does not have to be long.

Favor a varied mix of nouns, verbs, and adjectives. Do not limit the list to
weather, flowers, romance, or positive emotions: quiet, longing, light,
movement, atmosphere, and tenderness can all be beautiful.
`.trim(),

  elevated: `
Find elegant, mellifluous, evocative English vocabulary for readers and writers
who want to expand their expressive range beyond ordinary descriptive words.

Choose established words with nuanced emotional associations, distinctive
sound patterns, delicate imagery, or graceful literary usage. The vocabulary
should reward discovery: someone may have encountered a word in a novel or
essay without knowing precisely what it means. Favor words that convey a
specific atmosphere, quality, sensation, or subtle human experience.

Difficulty: ELEVATED. Select meaningfully less familiar vocabulary than the
accessible level, while remaining recognizable as legitimate English and
useful in thoughtful prose, poetry, essays, or personal writing. Avoid
everyday adjectives, simplistic synonyms for beauty, and showy words chosen
only because they are long. Do not drift into narrowly technical disciplines,
extinct expressions, or specialist jargon.

Include different parts of speech and different kinds of beauty: sonic,
emotional, atmospheric, visual, and conceptual. Avoid repeatedly suggesting
the same famous aesthetic vocabulary examples.
`.trim(),

  exceptional: `
Find unusually beautiful, rare, and linguistically distinctive English words
for an adventurous vocabulary enthusiast who enjoys poetic discoveries.

Choose authentic dictionary-attested words with striking phonetic qualities,
highly evocative meanings, unusual poetic associations, or precise names for
subtle sensations and atmospheric experiences. Favor vocabulary that feels
like an unexpected literary discovery rather than a difficult examination
question. Rare words may be historical or specialized when their aesthetic
or evocative quality is central, but they must have established English usage.

Difficulty: EXCEPTIONAL. Seek words that even widely read adults may not
recognize. Prioritize rarity together with genuine expressive value; a word
is not suitable merely because it is extremely long, obscure, scientific,
or hard to pronounce. Avoid fabricated internet 'untranslatable words',
dubious etymologies, proper names, and novelty terms with no dependable
dictionary entry.

Draw from multiple semantic areas and parts of speech. Include surprising
forms of beauty such as melancholy, fleetingness, silence, texture, memory,
and the natural world. Do not recycle a fixed list of viral rare words.
`.trim(),
};
