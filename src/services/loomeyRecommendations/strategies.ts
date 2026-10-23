import { authorKeys, distinct, emptyBook, hash, libraryIdentity, mergeBooks, normalized, ownedMatches, sameBook } from "./normalization";
import { Book, CategoryID, DiscoveryPlan, LibraryBook, ProviderName } from "./types";

const generic = new Set(["fiction", "nonfiction", "non fiction", "general", "books", "literature", "adult", "juvenile fiction", "young adult fiction", "english literature", "american literature", "fictional works"]);
export function interest(value: string): string {
  const key = normalized(value.replace(/(?:\s*--\s*|,\s*)fiction$/i, ""));
  if (!key || generic.has(normalized(value)) || /bestsell|award|new york times|reviewed|nyt |reading level|large type|accessible book|protected daisy/.test(key)) return "";
  return key;
}
export type ReadingProfile = { seeds: Book[]; genres: Map<string, number>; themes: Map<string, number>; terms: Map<string, string>; authors: Set<string>; signature: string };
export function finishedBooks(library: LibraryBook[]): LibraryBook[] { return library.filter(book => book.status.toLowerCase() === "finished" && book.title && book.author); }
export function profileKey(library: LibraryBook[]): string {
  return hash(JSON.stringify(finishedBooks(library).map(book => ({ ...book, genres: [...book.genres].sort(), subjects: [...book.subjects].sort() })).sort((a, b) => a.id.localeCompare(b.id))));
}
export function selectSeeds(library: LibraryBook[]): LibraryBook[] {
  const ranked = [...finishedBooks(library)].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.rating - a.rating || b.activity - a.activity || a.id.localeCompare(b.id));
  const selected: LibraryBook[] = [];
  const authors = new Set<string>();
  for (const seed of ranked) {
    const key = authorKeys(seed.author)[0] ?? seed.author;
    if (!authors.has(key)) { selected.push(seed); authors.add(key); }
    if (selected.length === 8) break;
  }
  return selected;
}
export function buildProfile(library: LibraryBook[], resolved: Book[]): ReadingProfile {
  const genres = new Map<string, number>();
  const themes = new Map<string, number>();
  const terms = new Map<string, string>();
  const authors = new Set<string>();
  const seeds = finishedBooks(library).map(source => {
    const seed = { ...emptyBook("google-books", `local_${source.id}`), title: source.title, authors: [source.author],
      subtitle: source.subtitle ?? null, isbns: source.isbn ? [source.isbn] : [], genres: source.genres, subjects: source.subjects, sources: [] } as Book;
    if (source.seriesName) {
      const position = Number(source.seriesNumber?.replace(/^book\s*/i, ""));
      seed.series = [{ id: `name_${normalized(source.seriesName)}`, name: source.seriesName, position: Number.isFinite(position) && position > 0 ? position : null }];
    }
    let enriched = seed;
    for (const candidate of resolved) if (sameBook(libraryIdentity(source), candidate)) enriched = mergeBooks(enriched, candidate);
    enriched.authors.flatMap(authorKeys).forEach(author => authors.add(author));
    const weight = (source.rating > 0 && source.rating < 3 ? 0.5 : 1) + Number(source.favorite) + (source.rating >= 4 ? 0.5 : 0);
    for (const [values, table] of [[enriched.genres, genres], [[...enriched.subjects, ...enriched.tags], themes]] as [string[], Map<string, number>][]) {
      for (const value of distinct(values.map(interest))) {
        table.set(value, (table.get(value) ?? 0) + weight);
        const original = [...enriched.genres, ...enriched.subjects, ...enriched.tags].find(term => interest(term) === value);
        terms.set(value, original ?? value);
      }
    }
    return enriched;
  });
  // Preserve the library's explicit theme/genre distinction when a provider flattens both into categories.
  const explicitGenres = new Set(finishedBooks(library).flatMap(book => book.genres.map(interest)).filter(Boolean));
  const explicitThemes = new Set(finishedBooks(library).flatMap(book => book.subjects.map(interest)).filter(Boolean));
  for (const theme of explicitThemes) if (!explicitGenres.has(theme) && genres.has(theme)) {
    themes.set(theme, Math.max(themes.get(theme) ?? 0, genres.get(theme) ?? 0));
    genres.delete(theme);
  }
  // Repeated provider labels are one signal, never counted as both a genre and a theme.
  for (const genre of genres.keys()) themes.delete(genre);
  return { seeds, genres, themes, terms, authors, signature: profileKey(library) };
}
const thematicCategories: CategoryID[] = ["similar", "genres", "themes", "new-authors", "related", "discovery"];
export function discoveryPlans(profile: ReadingProfile, targets: CategoryID[], provider: ProviderName): DiscoveryPlan[] {
  const plans: DiscoveryPlan[] = [];
  const add = (kind: DiscoveryPlan["kind"], categories: CategoryID[], detail: Partial<DiscoveryPlan>) => {
    const affected = categories.filter(id => targets.includes(id));
    if (!affected.length) return;
    const plan = { kind, categories: affected, terms: [], tagIDs: [], workIDs: [], ...detail };
    const key = hash(JSON.stringify({ ...plan, categories: undefined })).slice(0, 24);
    if (!plans.some(existing => existing.key === key)) plans.push({ ...plan, key });
  };
  const authors = new Set<string>();
  for (const seed of profile.seeds) {
    for (const author of seed.authors.slice(0, 2)) {
      const key = authorKeys(author)[0] ?? author;
      if (authors.has(key) || authors.size >= 3) continue;
      authors.add(key);
      const authorID = seed.authorIDs.find(id => id.startsWith(provider === "hardcover" ? "hc_" : "ol_"));
      add("author", ["authors-read"], { author, ...(authorID ? { authorID } : {}) });
    }
  }
  if (provider === "hardcover") {
    const series = new Set<string>();
    for (const seed of profile.seeds) for (const item of seed.series) {
      if (series.size >= 2) continue;
      const key = normalized(item.name);
      if (series.has(key)) continue;
      series.add(key);
      add("series", ["related", "similar"], /^hc_\d+$/.test(item.id) ? { seriesID: item.id } : { seriesName: item.name });
    }
    const ids = distinct(profile.seeds.flatMap(seed => seed.relatedIDs)).slice(0, 24);
    if (ids.length) add("related", ["related", "similar", "discovery"], { workIDs: ids });
    // Use paired, documented tag relationships rather than a speculative recommendation endpoint.
    for (const seed of profile.seeds.filter(seed => seed.tagIDs.length >= 2).slice(0, 3)) add("interests", thematicCategories, { tagIDs: seed.tagIDs.slice(0, 2) });
  }
  const ordered = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => profile.terms.get(key) ?? key);
  const genreTerms = ordered(profile.genres).slice(0, 4);
  const themeTerms = ordered(profile.themes).slice(0, 5);
  for (let i = 0; i < Math.max(genreTerms.length, themeTerms.length); i++) {
    const genre = genreTerms[i];
    const theme = themeTerms[i];
    if (genre && theme) add("interests", thematicCategories, { terms: [genre, theme] });
    if (theme) add("interests", thematicCategories.filter(id => id !== "genres"), { terms: [theme] });
    if (genre) add("interests", thematicCategories.filter(id => id !== "themes"), { terms: [genre] });
  }
  // Interleave author/relationship/interest work so no strategy monopolizes a provider's budget.
  const queue: DiscoveryPlan[] = [];
  const groups = [plans.filter(plan => plan.kind === "author"), plans.filter(plan => plan.kind === "series" || plan.kind === "related"), plans.filter(plan => plan.kind === "interests")];
  while (groups.some(group => group.length)) for (const group of groups) { const next = group.shift(); if (next) queue.push(next); }
  return queue.slice(0, provider === "hardcover" ? 10 : 9);
}

export type Relevance = { total: number; author: boolean; series: boolean; related: boolean; genres: number; themes: number; finishedMatches: number; newAuthor: boolean; popularity: number };
export function relevance(book: Book, profile: ReadingProfile): Relevance {
  const values = distinct([...book.genres, ...book.subjects, ...book.tags].map(interest));
  const genres = values.filter(value => profile.genres.has(value)).length;
  const themes = values.filter(value => profile.themes.has(value) && !profile.genres.has(value)).length;
  const author = book.authors.flatMap(authorKeys).some(key => profile.authors.has(key));
  const series = book.series.some(item => profile.seeds.some(seed => seed.series.some(previous => previous.id === item.id ||
    (normalized(previous.name) === normalized(item.name) && seed.authors.flatMap(authorKeys).some(key => book.authors.flatMap(authorKeys).includes(key))))));
  const related = profile.seeds.some(seed => seed.relatedIDs.includes(book.id) || book.relatedIDs.includes(seed.id) || seed.relatedIDs.some(id => book.providerIDs.hardcover?.some(hc => id === `hc_${hc}`)));
  const finishedMatches = profile.seeds.filter(seed => {
    const shared = values.filter(value => distinct([...seed.genres, ...seed.subjects, ...seed.tags].map(interest)).includes(value));
    return shared.length >= 2;
  }).length;
  const evidence = Math.min(genres, 3) * 4 + Math.min(themes, 4) * 6 + Number(author) * 18 + Number(series) * 28 + Number(related) * 8;
  return { total: evidence + Math.min(finishedMatches, 3) * 2, author, series, related, genres, themes, finishedMatches, newAuthor: !author, popularity: book.popularity };
}
export function categoryScore(category: CategoryID, match: Relevance): number | null {
  const multi = match.genres + match.themes >= 2;
  switch (category) {
    case "authors-read": return match.author ? match.total + 12 : null;
    case "related": return match.series || (match.related && match.genres + match.themes > 0) || (match.finishedMatches > 0 && match.themes >= 2 && match.genres > 0) ? match.total + Number(match.series) * 12 + Number(match.related) * 6 : null;
    case "similar": return multi || match.series || (match.author && match.themes > 0) ? match.total + match.finishedMatches * 3 : null;
    case "genres": return match.genres > 0 && multi ? match.total + match.genres * 6 : null;
    case "themes": return match.themes > 0 && multi ? match.total + match.themes * 8 : null;
    case "new-authors": return match.newAuthor && multi ? match.total + match.themes * 3 : null;
    case "discovery": return multi && match.newAuthor ? match.total + Math.max(0, 8 - Math.log2(1 + match.popularity)) : null;
  }
}
export function rankCategories(books: Book[], profile: ReadingProfile, library: LibraryBook[], targets: CategoryID[]): Map<CategoryID, Book[]> {
  const usable = books.filter(book => book.language === "eng" && book.title && book.authors.length && (book.coverUrls.length || book.imageID) && !library.some(owned => ownedMatches(owned, book)) && !profile.seeds.some(seed => sameBook(seed, book)));
  const result = new Map<CategoryID, Book[]>();
  for (const category of targets) {
    const ranked = usable.map(book => ({ book, match: relevance(book, profile), matchedGenres: distinct([...book.genres, ...book.subjects].map(interest)).filter(genre => profile.genres.has(genre)) })).map(item => ({ ...item, score: categoryScore(category, item.match) }))
      .filter((item): item is typeof item & { score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score || Math.min(3, Math.log1p(b.match.popularity)) - Math.min(3, Math.log1p(a.match.popularity)) || a.book.id.localeCompare(b.book.id));
    const selected: Book[] = [];
    const authorCounts = new Map<string, number>();
    const seriesCounts = new Map<string, number>();
    const genreCounts = new Map<string, number>();
    const pending = [...ranked];
    const adjusted = (item: typeof ranked[number]) => item.score
      - (authorCounts.get(authorKeys(item.book.authors[0] ?? "")[0] ?? "") ?? 0) * 4
      - Math.max(0, ...item.book.series.map(series => seriesCounts.get(series.id) ?? 0)) * 3
      - (profile.genres.size > 1 && item.matchedGenres.length ? Math.min(...item.matchedGenres.map(genre => genreCounts.get(genre) ?? 0)) * 2 : 0);
    while (pending.length && selected.length < 64) {
      pending.sort((a, b) => adjusted(b) - adjusted(a) || b.score - a.score || a.book.id.localeCompare(b.book.id));
      const { book, matchedGenres } = pending.shift()!;
      const author = authorKeys(book.authors[0] ?? "")[0] ?? "";
      if ((authorCounts.get(author) ?? 0) >= (category === "authors-read" ? 4 : 2) || book.series.some(series => (seriesCounts.get(series.id) ?? 0) >= 2)) continue;
      selected.push(book); authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
      for (const series of book.series) seriesCounts.set(series.id, (seriesCounts.get(series.id) ?? 0) + 1);
      for (const genre of matchedGenres) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
    result.set(category, selected);
  }
  return result;
}
