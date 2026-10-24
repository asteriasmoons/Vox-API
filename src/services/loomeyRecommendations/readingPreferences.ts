import { cleanText, distinct, normalized } from "./normalization";
import { Book, ReadingPreferences, RecommendationError } from "./types";

export function preferenceTerm(value: string): string {
  return normalized(value).replace(/\b(?:sci fi|scifi)\b/g, "science fiction").replace(/^non fiction$/, "nonfiction");
}

export function parseReadingPreferences(body: unknown): ReadingPreferences | undefined {
  const raw = (body as { preferences?: unknown })?.preferences;
  if (raw === undefined || raw === null) return undefined;
  const invalid = () => new RecommendationError("INVALID_READING_PREFERENCES", 400);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || !["fiction", "nonfiction", "both"].includes(String(value.preferredCategory))
    || !["follow_preferences", "blend_interests", "surprise_me"].includes(String(value.recommendationStyle))) throw invalid();
  const values = (key: string): string[] => {
    const entries = value[key];
    if (!Array.isArray(entries) || entries.some(entry => typeof entry !== "string" || entry.length > 384)) throw invalid();
    const terms = new Map<string, string>();
    for (const entry of entries) {
      const text = cleanText(entry).slice(0, 96);
      if (text && !terms.has(preferenceTerm(text))) terms.set(preferenceTerm(text), text);
    }
    return [...terms].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text);
  };
  return { version: 1, preferredCategory: value.preferredCategory as ReadingPreferences["preferredCategory"],
    recommendationStyle: value.recommendationStyle as ReadingPreferences["recommendationStyle"],
    favoriteFictionGenres: values("favoriteFictionGenres"), favoriteNonfictionGenres: values("favoriteNonfictionGenres"),
    currentlyInterestedIn: values("currentlyInterestedIn") };
}

export function favoriteGenres(value: ReadingPreferences): string[] {
  return distinct([...(value.preferredCategory !== "nonfiction" ? value.favoriteFictionGenres : []),
    ...(value.preferredCategory !== "fiction" ? value.favoriteNonfictionGenres : [])]);
}

export function hasPreferenceInputs(value?: ReadingPreferences): boolean {
  return !!value && (value.preferredCategory !== "both" || favoriteGenres(value).length > 0 || value.currentlyInterestedIn.length > 0);
}

export const readingCategoryTerms = {
  nonfiction: ["nonfiction", "non fiction", "history", "biography", "autobiography", "memoir", "psychology", "science", "spirituality", "witchcraft", "self help", "personal development", "productivity", "philosophy", "politics", "technology", "wellness", "writing craft", "art design", "art and design", "mindfulness", "trauma recovery", "habit building"],
  fiction: ["fiction", "fantasy", "romance", "mystery", "thriller", "horror", "science fiction", "novel", "novels", "young adult", "dark academia", "adventure", "paranormal", "mythology", "folklore", "manga", "graphic novel", "graphic", "comic", "dystopian", "magical realism", "litrpg"],
};

function containsTerm(value: string, term: string): boolean {
  if (term === "science" && /\bscience fiction\b/.test(value)) return false;
  if (term === "fiction" && /\bnon ?fiction\b/.test(value)) return false;
  return value === term || ` ${value} `.includes(` ${term} `);
}

export function preferenceEvidence(book: Book, preferences: ReadingPreferences) {
  const labels = distinct([...book.genres, ...book.subjects, ...book.tags].map(preferenceTerm));
  const matches = (term: string) => labels.some(label => containsTerm(label, preferenceTerm(term)));
  const classify = (values: string[]) => {
    const has = (term: string) => values.some(label => containsTerm(label, term));
    const explicitFiction = has('fiction');
    const explicitNonfiction = has('nonfiction') || has('non fiction');
    if (explicitFiction !== explicitNonfiction) return { fiction: explicitFiction, nonfiction: explicitNonfiction };
    return { fiction: readingCategoryTerms.fiction.some(has), nonfiction: readingCategoryTerms.nonfiction.some(has) };
  };
  const primary = classify(book.genres.map(preferenceTerm));
  const classification = primary.fiction || primary.nonfiction ? primary : classify(labels);
  const isNonfiction = classification.nonfiction;
  const isFiction = classification.fiction;
  const categoryMatch = preferences.preferredCategory === "both" ? isNonfiction || isFiction
    : preferences.preferredCategory === "fiction" ? isFiction : isNonfiction;
  const opposedCategory = preferences.preferredCategory === "fiction" ? isNonfiction && !isFiction
    : preferences.preferredCategory === "nonfiction" ? isFiction && !isNonfiction : false;
  return { favorites: favoriteGenres(preferences).filter(matches).length, current: preferences.currentlyInterestedIn.filter(matches).length,
    categoryMatch, opposedCategory, specificMetadata: labels.filter(label => !["fiction", "nonfiction", "non fiction", "general", "books", "literature"].includes(label)).length };
}
