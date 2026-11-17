import type { DiscoveryPromptCollection } from "../discoveryTypes";

/**
 * Historical & Archaic — historically attested English vocabulary,
 * from recognizable older expressions to genuinely rare obsolete terms.
 */
export const historicalAndArchaicPrompts: DiscoveryPromptCollection = {
  accessible: `
Discover historically flavored English words and expressions that help
a curious adult explore how English sounded and was used in earlier eras.

Difficulty: ACCESSIBLE. Choose established older words that are still
recognizable, appear in classic literature, historical fiction, or
period dialogue, and can be explained without specialist knowledge.
Prefer words with a clear meaning and an interesting historical flavor,
including terms that survive in literary or playful modern usage.

Explore social interaction, time, character, everyday objects, movement,
and ways of speaking. Include nouns, verbs, adjectives, and adverbs where
appropriate. Favor words whose historical character is part of their
appeal rather than merely old-fashioned spelling.

Avoid modern everyday words without a distinct historical register,
unintelligible medieval spellings, obscure dialect forms, proper names,
and specialized historical artifacts with no broader linguistic interest.
Do not invent Shakespearean-sounding vocabulary or claim that every
old-fashioned word originated with Shakespeare.
`.trim(),

  elevated: `
Discover distinctive, historically attested English vocabulary that was
once more widely used and now appears chiefly in older literature,
historical documents, period fiction, or deliberately antiquated prose.

Difficulty: ELEVATED. Choose words that a well-read adult might encounter
in classic novels, historical essays, or archival writing but may not
confidently define. Favor precise terms that illuminate historical
attitudes, customs, relationships, actions, and modes of expression.
Each word should be a legitimate English headword with a defensible
meaning and identifiable older or archaic register.

Draw from multiple centuries and subjects without pretending all older
English belongs to a single historical period. Include different parts
of speech and balance familiar literary archaisms with less predictable
discoveries. Distinguish genuinely archaic senses from words that are
simply formal or uncommon today.

Avoid elementary old-fashioned expressions, invented pseudo-medieval
words, arbitrary variant spellings, obsolete technical nomenclature,
and terms whose meaning depends entirely on one obscure historical
institution. Do not overproduce theatrical interjections or words
chosen solely for quaintness.
`.trim(),

  exceptional: `
Discover genuinely rare, obsolete, or highly archaic English vocabulary
with verifiable historical usage and fascinating semantic specificity.

Difficulty: EXCEPTIONAL. Seek words that even readers of classic
literature may not know, including forgotten verbs, unusual nouns,
archaic descriptive terms, and words whose historical meanings reveal
unexpected distinctions in older English. Candidates must be attested
English headwords rather than invented period-flavored expressions.

Explore language from different historical eras and registers, including
domestic life, social customs, emotions, conduct, conflict, and material
culture. Choose words whose definitions can stand alone and whose
historical context enriches their appeal. An obsolete word is acceptable
in this category when its established meaning can be verified.

Exclude fictional coinages, proper names, reconstructed unattested
forms, random Middle English spelling variants, and extremely narrow
scholarly transcription terms. Do not mistake non-English words for
archaic English. Avoid repeatedly selecting the same famous historical
curiosities; seek variety in era, grammatical function, and meaning.
`.trim(),
};
