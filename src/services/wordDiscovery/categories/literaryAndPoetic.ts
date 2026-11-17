import type { DiscoveryPromptCollection } from "../discoveryTypes";

/**
 * Literary & Poetic — vocabulary with expressive power in fiction,
 * poetry, narrative prose, and creative writing.
 */
export const literaryAndPoeticPrompts: DiscoveryPromptCollection = {
  accessible: `
Discover expressive English vocabulary that enriches fiction, poetry,
storytelling, and personal creative writing without sounding contrived.

Difficulty: ACCESSIBLE. Choose evocative, approachable words that a curious
adult might recognize from novels or poems but may not use often. Prefer
words that add texture to a scene, convey mood, suggest movement, describe
character, or sharpen imagery. Each word should be understandable after
a short explanation and usable in contemporary creative prose.

Seek variety across sensory description, atmosphere, narrative action,
voice, emotion, and setting. Include nouns, verbs, and adjectives rather
than offering only decorative adjectives. Favor precise expression over
ornament: a vivid verb can be more literary than a long adjective.

Exclude elementary words such as beautiful, nice, sad, and walk; generic
writing advice terminology; proper names; invented poetic compounds;
specialist literary-theory jargon; and deliberately difficult archaic
language. Avoid making every result romantic, gloomy, or nature-related.
`.trim(),

  elevated: `
Discover sophisticated, nuanced English vocabulary associated with
accomplished literary prose, poetry, criticism, and imaginative writing.

Difficulty: ELEVATED. Choose words that well-read adults may have encountered
in serious fiction, essays, or poetry but might not confidently define.
Favor precise words with rich connotations, expressive rhythm, subtle
emotional shading, or the ability to create a memorable image. They should
feel rewarding to learn and remain useful in thoughtful contemporary
writing rather than existing only as ornamental curiosities.

Explore multiple literary functions: scene-setting, characterization,
tone, movement, perception, inner conflict, texture, and metaphorical
description. Draw from verbs and nouns as readily as adjectives.
Favor distinctive meanings over mere length or unusual spelling.

Avoid basic everyday vocabulary, technical academic labels for literary
devices, narrow scientific terms, fabricated expressions, and heavily
obsolete words. Do not repeatedly draw from the same famous list of
poetic-sounding vocabulary; vary registers, themes, and semantic fields.
`.trim(),

  exceptional: `
Discover rare, authentic English vocabulary with exceptional literary
or poetic potential: words that can transform a sentence through their
specific meaning, sound, imagery, or historical resonance.

Difficulty: EXCEPTIONAL. Seek dictionary-attested words that even widely
read adults may not know. Appropriate candidates include uncommon poetic
verbs, evocative nouns, unusual descriptive adjectives, and carefully
selected historical literary vocabulary with genuine English usage.
A candidate must contribute expressive precision or imaginative force,
not merely be difficult to spell or pronounce.

Explore uncommon ways to describe atmosphere, motion, silence, memory,
decay, splendor, uncertainty, desire, and sensory experience, without
restricting results to these subjects. Include varied parts of speech
and both luminous and unsettling tones. Some words may be archaic,
but avoid terms so obsolete or context-dependent that they are useless
outside specialist scholarship.

Exclude invented words, author-specific fictional names, dubious internet
etymologies, literary-critical jargon, and obscure technical terms with
no meaningful creative-writing application. Prioritize authentic words
with dependable dictionary definitions over fashionable lists of
supposedly rare and beautiful words.
`.trim(),
};
