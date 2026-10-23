import { BookDatabaseClient, Reference, Resource, refs } from "./bookDatabaseClient";
import { CatalogError, CatalogStore, digest, mongoCatalogStore } from "./automaticCatalogStore";
import { randomUUID } from "node:crypto";
import { catalogFailure, catalogLog } from "./catalogDiagnostics";
import { authorKeys, bookKey, canonicalISBN, CatalogIdentityIndex, cleanTitle, normalize, normalizeISBN, validISBN } from "./catalogBookIdentity";
import { allocateCatalogs, CatalogBuildResult, catalogIDs, CategoryState, PreparedCatalogCache } from "./automaticCatalogCache";
export { bookKey, canonicalISBN, cleanTitle, normalize, normalizeISBN, validISBN } from "./catalogBookIdentity";

export type LibrarySignal = {
  id: string; title: string; author: string; isbn?: string; genres: string[]; subjects: string[];
  rating: number; favorite: boolean; status: string; activity: number; providerBookID?: string;
};
export type CatalogBook = {
  id: string; title: string; author: string; summary: string; subtitle: string | null;
  isbn: string | null; pages: number | null; publisher: string | null; releaseYear: number | null;
  coverUrl: string | null; imageID: string | null; genres: string[]; subjects: string[];
  authorIDs: string[]; subjectIDs: string[]; genreIDs: string[]; source: string;
  authorNames?: string[];
  metadataIncomplete?: boolean;
  language?: string;
  languageIDs?: string[];
  editionID?: string;
  isbns?: string[];
  titleVariants?: string[];
};
export type AutomaticCatalog = { id: string; title: string; books: CatalogBook[]; generatedAt?: string; refreshAfter?: string; expiresAt?: string; state?: string };
export type CatalogResponse = { catalogs: AutomaticCatalog[]; generatedAt: string; expiresAt: string; refreshAfter?: string; partial: boolean; traceID?: string; categoryStates?: Record<string, CategoryState> };
export type CatalogJobResponse = CatalogResponse & { state: "building" | "ready" | "failed"; errorCode?: string; retryAfter?: number };
const signalKey = (library: LibrarySignal[]) => digest(JSON.stringify(library.filter(positiveSignal)));
const catalogKey = (library: LibrarySignal[]) => `catalog-v12-persistent:${signalKey(library)}:${digest(JSON.stringify(library.map(book => ({ id: book.id, title: book.title, author: book.author, isbn: book.isbn, providerBookID: book.providerBookID }))))}`;
export function matchesIdentity(seed: Pick<LibrarySignal, "title" | "author">, candidate: Resource): boolean {
  const titles = [candidate.title ?? "", ...(candidate.alternateTitles ?? [])].map(title => normalize(cleanTitle(title)));
  const authors = names(refs(candidate, "authors"));
  return titles.includes(normalize(cleanTitle(seed.title))) && !!normalize(seed.author) &&
    [...authors, authors.join(", ")].some(author => authorKeys(author).some(key => authorKeys(seed.author).includes(key)));
}
const broad = new Set(["fiction", "nonfiction", "non fiction", "literature", "books", "general", "adult", "juvenile fiction", "english fiction"]);
const specific = (names: string[]) => names.filter(name => !broad.has(normalize(name))
  && !/^(award:|nyt:)/i.test(name) && !/bestsell|new york times|reviewed|award winner/i.test(name));
const subjectKey = (name: string) => normalize(name).replace(/\s+fiction$/, "").trim();
const specificSubjects = (values: string[]) => unique(specific(values)
  .filter(name => !/^(american|english|british|world) literatures?$/.test(normalize(name))
    && !["fictions", "science fictions", "science fiction", "fiction science fiction general"].includes(normalize(name)))
  .map(subjectKey));
const unique = (items: string[]) => [...new Set(items.filter(Boolean))];
const names = (items: Reference[]) => unique(items.map(r => r.name?.trim() ?? ""));
const namedRefs = (items: Reference[]) => {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = normalize(item.name ?? "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const path = (type: string, id: string) => `${type}/${encodeURIComponent(id)}?includeRelationships=All`;
const positiveSignal = (book: LibrarySignal) => book.status.toLowerCase() === "finished" && !!book.title.trim() && !!book.author.trim() && !(book.rating > 0 && book.rating < 3);
const metadataProfile = (library: LibrarySignal[]) => {
  const positive = library.filter(positiveSignal);
  return {
    genres: new Set(specific(positive.flatMap(book => book.genres)).map(normalize)),
    subjects: new Set(specificSubjects(positive.flatMap(book => book.subjects))),
  };
};
function profileSimilarity(book: CatalogBook, profile: ReturnType<typeof metadataProfile>): Similarity {
  const genres = unique(specific(book.genres).map(normalize)).filter(genre => profile.genres.has(genre)).length;
  const subjects = specificSubjects(book.subjects).filter(subject => profile.subjects.has(subject)).length;
  return { genres, subjects, authors: 0, score: Math.min(genres, 4) * 3 + Math.min(subjects, 5) * 5 + (genres && subjects ? 5 : 0) };
}

export function parseLibrary(body: any): LibrarySignal[] {
  if (!body || !Array.isArray(body.books) || body.books.length > 1000) throw new CatalogError("INVALID_LIBRARY", 400);
  const text = (value: unknown, max = 256) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const strings = (value: unknown) => Array.isArray(value) ? value.filter(v => typeof v === "string").slice(0, 20).map(v => text(v)) : [];
  return body.books.map((book: any) => {
    if (!book || !text(book.id) || typeof book.title !== "string" || typeof book.author !== "string") throw new CatalogError("INVALID_BOOK", 400);
    return { id: text(book.id), title: text(book.title, 2048), author: text(book.author), isbn: text(book.isbn, 64),
      genres: strings(book.genres), subjects: strings(book.subjects),
      rating: typeof book.rating === "number" ? Math.min(5, Math.max(0, book.rating)) : 0,
      favorite: book.favorite === true, status: text(book.status, 40), providerBookID: text(book.providerBookID, 128) || undefined,
      activity: typeof book.activity === "number" && Number.isFinite(book.activity) ? Math.min(1000, Math.max(0, book.activity)) : 0 };
  }).sort((a: LibrarySignal, b: LibrarySignal) => a.id.localeCompare(b.id));
}

export type Similarity = { score: number; genres: number; subjects: number; authors: number };
export function similarity(candidate: CatalogBook, seeds: CatalogBook[]): Similarity {
  let best: Similarity = { score: 0, genres: 0, subjects: 0, authors: 0 };
  for (const seed of seeds) {
    const genres = specific(candidate.genres).filter(g => specific(seed.genres).some(s => normalize(g) === normalize(s))).length;
    const subjects = specificSubjects(candidate.subjects).filter(g => specificSubjects(seed.subjects).includes(g)).length;
    const authors = candidate.authorIDs.filter(id => seed.authorIDs.includes(id)).length;
    const score = Math.min(genres, 4) * 3 + Math.min(subjects, 5) * 5 + (authors ? 4 : 0) + (genres && subjects ? 5 : 0);
    if (score > best.score) best = { score, genres, subjects, authors };
  }
  return best;
}

export class AutomaticCatalogService {
  private inFlight = new Map<string, Promise<CatalogResponse>>();
  constructor(private client: BookDatabaseClient, private store: CatalogStore, private buildTimeoutMs = 300_000) {}

  async requestCatalogs(library: LibrarySignal[], forceRefresh = false, traceID = randomUUID(), requested = catalogIDs): Promise<CatalogJobResponse> {
    const activeUntil = await this.client.assertActive();
    const prepared = new PreparedCatalogCache(this.store, signalKey(library));
    const cached = await prepared.read(library, activeUntil);
    const targets = forceRefresh ? requested : prepared.stale(cached, requested);
    const key = catalogKey(library);
    const jobKey = `job:${key}`;
    const previous = await this.store.get(jobKey) as CatalogJobResponse | undefined;
    if (previous?.state === "building" || (previous?.state === "failed" && !forceRefresh)) {
      catalogLog("job.resume", { state: previous.state, catalogs: previous.catalogs.length }, previous.traceID ?? traceID);
      return { ...previous, ...cached, partial: previous.partial || cached.partial, state: previous.state, traceID: previous.traceID ?? traceID };
    }
    if (!targets.length) {
      catalogLog("job.cache_hit", { catalogs: cached.catalogs.length }, traceID);
      const failure = !cached.catalogs.length && Object.values(cached.categoryStates ?? {}).find(state => state.state === "error");
      return { ...cached, state: failure ? "failed" : "ready", ...(failure ? { errorCode: failure.errorCode ?? "PROVIDER_UNAVAILABLE" } : {}), traceID };
    }
    const expiresAt = new Date(Math.min(Date.now() + this.buildTimeoutMs + 15_000, activeUntil));
    let snapshot: CatalogJobResponse = {
      ...cached, partial: true, state: "building", retryAfter: 4, traceID,
    };
    const owner = randomUUID();
    if (!await this.store.claim(jobKey, owner, this.buildTimeoutMs + 30_000)) return previous ?? snapshot;
    try { await this.store.set(jobKey, snapshot, expiresAt); }
    catch (error) { await this.store.release(jobKey, owner); throw error; }
    // The existing server process completes the metadata fetch; HTTP callers only read snapshots.
    catalogLog("job.start", { libraryBooks: library.length, categories: targets, maxSeeds: 12, maxSeedLookups: 36, maxCandidates: 64, maxPlans: 24, deadlineMs: this.buildTimeoutMs }, traceID);
    void this.catalogs(library, async response => {
      snapshot = { ...response, state: "building", retryAfter: 4, traceID };
      await this.store.set(jobKey, snapshot, expiresAt);
    }, true, traceID, targets).then(async response => {
      catalogLog("job.ready", { catalogs: response.catalogs.map(c => ({ id: c.id, books: c.books.length })), partial: response.partial }, traceID);
      await this.store.set(jobKey, { ...response, state: "ready", traceID }, new Date(response.expiresAt));
    }).catch(async (error: unknown) => {
      const failure = error instanceof CatalogError ? error : new CatalogError("CATALOG_UNAVAILABLE");
      catalogLog("job.failed", catalogFailure(error), traceID);
      if (["PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(failure.code)) snapshot = { ...snapshot, catalogs: [], categoryStates: {} };
      await this.store.set(jobKey, { ...snapshot, state: "failed", errorCode: failure.code }, new Date(Date.now() + 30_000));
    }).finally(() => this.store.release(jobKey, owner)).catch(() => {
      console.warn("Automatic catalog job storage unavailable");
    });
    return snapshot;
  }

  async catalogs(library: LibrarySignal[], publish?: (response: CatalogResponse) => Promise<void>, forceRefresh = false, traceID = randomUUID(), requested = catalogIDs): Promise<CatalogResponse> {
    const activeUntil = await this.client.assertActive();
    const prepared = new PreparedCatalogCache(this.store, signalKey(library));
    const cached = await prepared.read(library, activeUntil);
    const targets = forceRefresh ? requested : prepared.stale(cached, requested);
    if (!targets.length) return cached;
    const key = `${catalogKey(library)}:${targets.join(",")}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new CatalogError("CATALOG_TIMED_OUT", 504, 30)), this.buildTimeoutMs);
    const pending = this.build(library, activeUntil, this.client.withSignal(controller.signal, traceID), async progress => {
      await prepared.write(progress, targets, false, activeUntil);
      if (publish) await publish({ ...await prepared.read(library, activeUntil), partial: true, traceID });
    }, targets).then(async result => {
      await prepared.write(result, targets, true, activeUntil);
      const response = await prepared.read(library, activeUntil);
      return { ...response, partial: result.partial || response.partial, traceID };
    }).catch(async (error: unknown) => {
      if (error instanceof CatalogError && ["PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error.code)) throw error;
      await prepared.write({ catalogs: [], generatedAt: new Date().toISOString(), expiresAt: cached.expiresAt, partial: true }, targets, true, activeUntil);
      const retained = await prepared.read(library, activeUntil);
      if (!retained.catalogs.length) throw error;
      catalogLog("catalog.retained_after_failure", { categories: retained.catalogs.map(row => row.id), ...catalogFailure(error) }, traceID);
      return { ...retained, partial: true, traceID };
    });
    this.inFlight.set(key, pending);
    try { return await pending; } finally { clearTimeout(timer); this.inFlight.delete(key); }
  }

  private async englishLanguage(client: BookDatabaseClient, hints: string[] = []): Promise<string> {
    const cached = await this.store.get("english-language-v1") as { id?: string; iso639Code?: string } | undefined;
    if (cached?.id && cached.iso639Code === "eng") return cached.id;
    const remember = async (language: Resource) => {
      if (language.iso639Code !== "eng") return null;
      await this.store.set("english-language-v1", { id: language.id, iso639Code: "eng" }, new Date(Math.min(Date.now() + 86_400_000, await client.assertActive())));
      catalogLog("language.resolved", { id: language.id, iso639Code: "eng" }, client.traceID);
      return language.id;
    };
    for (const id of unique(hints)) {
      const language: Resource | null = await client.get(`languages/${encodeURIComponent(id)}`);
      if (language) { const english = await remember(language); if (english) return english; }
    }
    // The language endpoint has no text-search filter. Follow its documented HAL pages.
    for await (const languages of client.pages("languages", { sortOrder: "EnglishNameAlphabetic", pageSize: "100" }, 80)) {
      for (const language of languages) { const english = await remember(language); if (english) return english; }
    }
    throw new CatalogError("ENGLISH_LANGUAGE_UNAVAILABLE", 503);
  }

  async work(id: string, client = this.client, englishLanguageID?: string): Promise<CatalogBook | null> {
    const resource: Resource | null = await client.get(path("books", id));
    if (!resource) return null;
    const languageID = englishLanguageID ?? await this.englishLanguage(client);
    const linkedEditions = refs(resource, "editions");
    for (const ref of linkedEditions.slice(0, 8)) {
      const edition: Resource | null = await client.get(path("editions", ref.id));
      const mapped = edition ? this.map(resource, edition, languageID) : null;
      if (mapped) return mapped;
    }
    if (!linkedEditions.length || linkedEditions.length > 8) {
      // Some documented compound filters stall upstream. Fall back to the work's
      // editions, but require the same language relationship on every record.
      const queries = [{ bookId: id, languageId: languageID }, { bookId: id }];
      for (const query of queries) {
        try {
          const bounded = client.withTimeout?.(12_000) ?? client;
          for await (const editions of bounded.pages("editions", { ...query, includeRelationships: "All", pageSize: "5" }, 2)) {
            for (const edition of editions) {
              const mapped = this.map(resource, edition, languageID);
              if (mapped) return mapped;
            }
          }
          break;
        } catch (error) {
          if (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED", "CATALOG_TIMED_OUT"].includes(error.code)) throw error;
          catalogLog("book.edition_query_failed", { workID: id, filtered: "languageId" in query, ...catalogFailure(error) }, client.traceID);
        }
      }
    }
    catalogLog("book.rejected", { workID: id, reason: "no_verified_english_edition" }, client.traceID);
    return null;
  }

  private map(work: Resource, edition?: Resource, englishLanguageID?: string): CatalogBook | null {
    // ISBN relationships in live provider data can point to a different title.
    // Never attach that edition's metadata to an unrelated work.
    if (edition && (!refs(edition, "books").some(r => r.id === work.id) ||
      (!englishLanguageID && ![edition.title ?? "", ...(edition.alternateTitles ?? [])].some(title => normalize(title) === normalize(work.title ?? ""))))) edition = undefined;
    if (englishLanguageID && (!edition?.title?.trim() || !refs(edition, "languages").some(language => language.id === englishLanguageID))) return null;
    const workAuthors = refs(work, "authors");
    const editionAuthors = edition ? refs(edition, "authors") : [];
    if (workAuthors.length && editionAuthors.length && !editionAuthors.some(author => workAuthors.some(original => original.id === author.id || authorKeys(original.name ?? "").some(key => authorKeys(author.name ?? "").includes(key))))) return null;
    const authors = names(refs(work, "authors")).length ? refs(work, "authors") : edition ? refs(edition, "authors") : [];
    if (!work.id || !work.title?.trim() || names(authors).length === 0) return null;
    const isbn = edition?.isbns?.filter(validISBN).map(normalizeISBN).sort((a, b) => b.length - a.length)[0] ?? null;
    const genres = namedRefs(edition ? refs(edition, "genres") : []);
    const subjects = namedRefs(refs(work, "subjects"));
    const title = cleanTitle(englishLanguageID ? edition!.title! : work.title);
    const sameTitle = normalize(title) === normalize(cleanTitle(work.title));
    const imageID = (edition ? refs(edition, "images")[0]?.id : undefined) ?? (sameTitle ? refs(work, "images")[0]?.id : undefined) ?? null;
    if (englishLanguageID && !imageID && !isbn) return null;
    return { id: work.id, title, author: names(authors).join(", "),
      summary: edition?.description?.trim() || (sameTitle ? work.description?.trim() : "") || "", subtitle: edition?.subtitle ?? (sameTitle ? work.subtitle : null) ?? null,
      isbn, pages: edition?.pageCount ?? null, publisher: edition ? names(refs(edition, "publishers"))[0] ?? null : null,
      releaseYear: null, coverUrl: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : null, imageID,
      ...(edition ? { editionID: edition.id } : {}), isbns: edition?.isbns?.filter(validISBN).map(normalizeISBN) ?? [],
      titleVariants: unique([work.title, ...(work.alternateTitles ?? []), edition?.title ?? "", ...(edition?.alternateTitles ?? [])].map(cleanTitle)),
      genres: names(genres), subjects: names(subjects), authorIDs: authors.map(a => a.id), authorNames: names(authors),
      subjectIDs: subjects.map(s => s.id), genreIDs: genres.map(g => g.id), source: "bookdatabase.io",
      languageIDs: edition ? refs(edition, "languages").map(language => language.id) : [], ...(englishLanguageID ? { language: "eng" } : {}) };
  }

  async match(seed: LibrarySignal, client = this.client, isbnOnly = false): Promise<CatalogBook | null> {
    if (seed.providerBookID && /^[a-zA-Z0-9_-]{1,128}$/.test(seed.providerBookID)) {
      const resource = await client.get(path("books", seed.providerBookID));
      if (resource && matchesIdentity(seed, resource)) return this.work(resource.id, client);
    }
    if (seed.isbn && validISBN(seed.isbn)) {
      const editions = await client.page("editions", { isbn: normalizeISBN(seed.isbn), includeRelationships: "All", pageSize: "3" });
      const edition = editions.find(e => (e.isbns ?? []).some(i => canonicalISBN(i) === canonicalISBN(seed.isbn!)));
      const works = edition ? refs(edition, "books") : [];
      if (edition && works.length === 1) {
        const work = await client.get(path("books", works[0]!.id));
        if (work && matchesIdentity(seed, work)) return this.map(work, edition);
      }
    }
    if (isbnOnly) return null;
    let workSearchError: unknown;
    try {
      const results = await client.page("books", { searchQuery: cleanTitle(seed.title).slice(0, 128), searchMode: "Exact", sortOrder: "SearchRelevanceDescending", includeRelationships: "None", pageSize: "3" });
      const works: Resource[] = [];
      for (const result of results) {
        if (![result.title ?? "", ...(result.alternateTitles ?? [])].some(title => normalize(cleanTitle(title)) === normalize(cleanTitle(seed.title)))) continue;
        const work = await client.get(path("books", result.id));
        if (work) works.push(work);
      }
      const exact = works.filter(work => matchesIdentity(seed, work));
      // A same-title/same-author ambiguity is not safe to resolve by result order.
      if (exact.length > 1) return null;
      if (exact.length === 1) return this.work(exact[0]!.id, client);
    } catch (error) {
      if (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED", "CATALOG_TIMED_OUT"].includes(error.code)) throw error;
      workSearchError = error;
    }
    // Editions have their own documented title index. Do not depend solely on
    // the work-title index when it is incomplete or returning invalid results.
    const results = await client.page("editions", { searchQuery: cleanTitle(seed.title).slice(0, 128), searchMode: "Exact", sortOrder: "SearchRelevanceDescending", includeRelationships: "None", pageSize: "3" });
    const editions: Resource[] = [];
    for (const result of results) {
      const edition = await client.get(path("editions", result.id));
      if (edition) editions.push(edition);
    }
    const exactEditions = editions.filter(edition => matchesIdentity(seed, edition));
    const workIDs = unique(exactEditions.flatMap(edition => refs(edition, "books").map(work => work.id)));
    if (workIDs.length !== 1) {
      if (workSearchError && !editions.length) throw workSearchError;
      return null;
    }
    const work = await client.get(path("books", workIDs[0]!));
    return work && matchesIdentity(seed, work) ? this.map(work, exactEditions[0]) : null;
  }

  private async build(library: LibrarySignal[], activeUntil: number, client: BookDatabaseClient, publish?: (response: CatalogBuildResult) => Promise<void>, targets = catalogIDs): Promise<CatalogBuildResult> {
    let partial = false;
    let exhausted = false;
    let remaining = 64;
    let englishLanguageID: string | undefined;
    const seedPriority = (b: LibrarySignal) => Number(b.favorite) * 20 + b.rating * 3 + Math.log1p(b.activity);
    const rankedSignals = [...library].filter(positiveSignal)
      .sort((a, b) => seedPriority(b) - seedPriority(a));
    const representedAuthors = new Set<string>();
    const firstByAuthor = rankedSignals.filter(book => {
      const key = normalize(book.author);
      if (representedAuthors.has(key)) return false;
      representedAuthors.add(key); return true;
    });
    const seedSignals = [...firstByAuthor, ...rankedSignals.filter(book => !firstByAuthor.includes(book))].slice(0, 36);
    const profile = metadataProfile(library);
    const hasProfile = profile.genres.size > 0 || profile.subjects.size > 0;
    let profileExpanded = false;
    catalogLog("discovery.profile", { libraryBooks: library.length, finishedBooks: library.filter(book => book.status.toLowerCase() === "finished").length, eligibleBooks: rankedSignals.length, seedBooks: Math.min(seedSignals.length, 12), seedLookups: seedSignals.length, authors: representedAuthors.size,
      genres: profile.genres.size, subjects: profile.subjects.size }, client.traceID);
    const seeds: CatalogBook[] = [];
    const candidates = new Map<string, CatalogBook>();
    const owned = new CatalogIdentityIndex(library);
    const excludedIDs = new Set<string>(library.flatMap(book => book.providerBookID ? [book.providerBookID] : []));
    const failures = new Map<string, string>();
    const attempted = new Set<string>();
    const categoriesFor = (query: Record<string, string>) => (query.authorId ? ["authors-read"] : query.genreId ? ["similar", "genres", "new-authors", "related", "discovery"] : query.subjectId ? ["similar", "themes", "new-authors", "related", "discovery"] : targets.filter(id => id !== "authors-read"));
    const plans: { collection: string; query: Record<string, string> }[] = [];
    const completed = new Set<string>();
    const previews = new Set<string>();
    const hydratedWorks = new Map<string, CatalogBook | null>();
    const expand = async (plan: typeof plans[number], preview = false) => {
      const key = JSON.stringify(plan);
      const affected = categoriesFor(plan.query).filter(id => targets.includes(id));
      if (!affected.length) return;
      if (exhausted || (completed.has(key) && (preview || !previews.has(key))) || (!completed.has(key) && completed.size >= 24) || remaining <= 0 || !englishLanguageID) return;
      completed.add(key);
      affected.forEach(id => attempted.add(id));
      if (preview) previews.add(key); else previews.delete(key);
      const query = plan.collection === "editions" ? { ...plan.query, languageId: englishLanguageID } : plan.query;
      catalogLog("discovery.plan_start", { collection: plan.collection, query, plan: completed.size, preview, candidateBudget: remaining }, client.traceID);
      try {
        let accepted = 0;
        const pages = async function* () {
          let yielded = false;
          try {
            const bounded = client.withTimeout?.(12_000) ?? client;
            for await (const results of bounded.pages(plan.collection, { ...query, includeRelationships: "None", pageSize: "12" }, preview ? 1 : 3)) {
              yielded = true;
              yield results;
            }
          } catch (error) {
            if (yielded || plan.collection !== "editions" || (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED", "CATALOG_TIMED_OUT"].includes(error.code))) throw error;
            catalogLog("discovery.language_filter_fallback", { query: plan.query, ...catalogFailure(error) }, client.traceID);
            const bounded = client.withTimeout?.(12_000) ?? client;
            yield* bounded.pages(plan.collection, { ...plan.query, includeRelationships: "None", pageSize: "12" }, preview ? 1 : 3);
          }
        };
        for await (const results of pages()) {
          for (const result of results) {
            try {
            const edition: Resource | null = plan.collection === "editions" ? await client.get(path("editions", result.id)) : null;
            if (plan.collection === "editions" && !edition) continue;
            if (edition && !refs(edition, "languages").some(language => language.id === englishLanguageID)) {
              catalogLog("candidate.rejected", { editionID: edition.id, reason: "non_english_or_unknown_language", languages: refs(edition, "languages").map(language => language.id) }, client.traceID);
              continue;
            }
            if (edition && plan.query.genreId && !refs(edition, "genres").some(genre => genre.id === plan.query.genreId)) {
              catalogLog("candidate.rejected", { editionID: edition.id, reason: "genre_relationship_mismatch" }, client.traceID);
              continue;
            }
            const workIDs = edition ? refs(edition, "books").map(r => r.id) : [result.id];
            for (const id of workIDs) {
              if (excludedIDs.has(id) || candidates.has(id) || remaining <= 0) continue;
              if (!edition && hydratedWorks.has(id) && !hydratedWorks.get(id)) continue;
              let mapped: CatalogBook | null;
              if (plan.collection === "editions") {
                remaining--;
                const work = await client.get(path("books", id));
                mapped = work ? this.map(work, edition ?? undefined, englishLanguageID) : null;
              } else if (hydratedWorks.has(id)) {
                mapped = hydratedWorks.get(id)!;
              } else {
                remaining--;
                mapped = await this.work(id, client, englishLanguageID);
                hydratedWorks.set(id, mapped);
              }
              if (mapped && plan.query.authorId && !mapped.authorIDs.includes(plan.query.authorId)) {
                catalogLog("candidate.rejected", { workID: id, reason: "author_relationship_mismatch" }, client.traceID);
                continue;
              }
              if (mapped && plan.query.subjectId && !mapped.subjectIDs.includes(plan.query.subjectId)) {
                catalogLog("candidate.rejected", { workID: id, reason: "subject_relationship_mismatch" }, client.traceID);
                continue;
              }
              if (mapped && !plan.query.authorId && !plan.query.genreId && !plan.query.subjectId && profileSimilarity(mapped, profile).score === 0 && similarity(mapped, seeds).score === 0) {
                catalogLog("candidate.rejected", { workID: id, reason: "no_library_metadata_overlap" }, client.traceID);
                continue;
              }
              if (mapped && !owned.has(mapped) && !new CatalogIdentityIndex(seeds).has(mapped)) {
                candidates.set(id, mapped);
                mapped.genreIDs.forEach((genreId, index) => {
                  if (!profile.genres.has(normalize(mapped.genres[index] ?? ""))) return;
                  const related = { collection: "editions", query: { genreId } };
                  if (!plans.some(existing => JSON.stringify(existing) === JSON.stringify(related))) plans.push(related);
                });
                catalogLog("candidate.accepted", { workID: id, language: mapped.language, genres: mapped.genres.length, subjects: mapped.subjects.length, totalCandidates: candidates.size }, client.traceID);
                if (mapped.metadataIncomplete) partial = true;
                accepted++;
                if (publish && candidates.size >= 2) await publish(this.assemble(library, seeds, [...candidates.values()], true, activeUntil));
              }
            }
            } catch (error) {
              if (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED", "CATALOG_TIMED_OUT"].includes(error.code)) throw error;
              partial = true;
              affected.forEach(id => failures.set(id, "INVALID_PROVIDER_RECORD"));
              catalogLog("candidate.failed", { resourceID: result.id, ...catalogFailure(error) }, client.traceID);
            }
            if (remaining <= 0 || accepted >= (preview ? 2 : 8)) break;
          }
          if (remaining <= 0 || accepted >= (preview ? 2 : 8)) break;
        }
        catalogLog("discovery.plan_complete", { collection: plan.collection, query, accepted, totalCandidates: candidates.size }, client.traceID);
      } catch (error) {
        if (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error.code)) throw error;
        catalogLog("discovery.plan_failed", { collection: plan.collection, query, ...catalogFailure(error) }, client.traceID);
        affected.forEach(id => failures.set(id, error instanceof CatalogError ? error.code : "PROVIDER_UNAVAILABLE"));
        partial = true;
        if (error instanceof CatalogError && error.code === "CATALOG_TIMED_OUT") {
          if (candidates.size < 2) throw error;
          exhausted = true;
        }
      }
    };
    const expandProfile = async () => {
      if (!hasProfile || profileExpanded || !englishLanguageID) return;
      profileExpanded = true;
      const plan = { collection: "editions", query: { languageId: englishLanguageID } };
      plans.push(plan);
      catalogLog("discovery.profile_start", { genres: profile.genres.size, subjects: profile.subjects.size }, client.traceID);
      await expand(plan, true);
    };
    const knownEnglish = await this.store.get("english-language-v1") as { id?: string; iso639Code?: string } | undefined;
    if (knownEnglish?.id && knownEnglish.iso639Code === "eng") {
      englishLanguageID = knownEnglish.id;
    }
    // Publish useful results from the first matched seed while matching the rest continues.
    for (const signal of seedSignals) {
      if (seeds.length >= 12 || exhausted) break;
      const isbnOnly = seedSignals.indexOf(signal) >= 12;
      if (isbnOnly && (!signal.isbn || !validISBN(signal.isbn))) continue;
      try {
        catalogLog("seed.match_start", { seed: seedSignals.indexOf(signal) + 1, identity: digest(bookKey(signal.title, signal.author)).slice(0, 12), hasISBN: !!signal.isbn, isbnOnly }, client.traceID);
        const book = await this.match(signal, client, isbnOnly);
        if (book && !seeds.some(s => s.id === book.id)) {
          englishLanguageID ??= await this.englishLanguage(client, book.languageIDs);
          catalogLog("seed.matched", { workID: book.id, authors: book.authorIDs.length, genres: book.genres.length, subjects: book.subjects.length }, client.traceID);
          seeds.push(book);
          if (book.metadataIncomplete) partial = true;
          excludedIDs.add(book.id);
          candidates.delete(book.id);
          refsForSeed(book).forEach(plan => {
            if (!plans.some(existing => JSON.stringify(existing) === JSON.stringify(plan))) plans.push(plan);
          });
          const kind = ["authorId", "genreId", "subjectId"][(seeds.length - 1) % 3]!;
          const available = refsForSeed(book).filter(plan => categoriesFor(plan.query).some(id => targets.includes(id)) && !completed.has(JSON.stringify(plan)));
          const preview = available.find(plan => plan.query[kind]) ?? available.find(plan => plan.query.authorId) ?? available[0];
          if (preview) await expand(preview, true);
        } else catalogLog("seed.unmatched", { seed: seedSignals.indexOf(signal) + 1, reason: book ? "duplicate_work" : "no_exact_title_author_or_isbn_match" }, client.traceID);
      } catch (error) {
        if (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error.code)) throw error;
        catalogLog("seed.failed", { seed: seedSignals.indexOf(signal) + 1, ...catalogFailure(error) }, client.traceID);
        partial = true;
        if (error instanceof CatalogError && error.code === "CATALOG_TIMED_OUT") {
          if (candidates.size < 2) throw error;
          break;
        }
      }
      if (exhausted) break;
    }
    if (!seeds.length && !hasProfile && partial) throw new CatalogError("PROVIDER_UNAVAILABLE");
    if (hasProfile && !englishLanguageID) {
      englishLanguageID = await this.englishLanguage(client);
    }
    if (!seeds.length) await expandProfile();
    // Interleave classifications so author queries cannot consume the entire discovery budget.
    while (!exhausted && remaining > 0) {
      const pending = (plan: typeof plans[number]) => categoriesFor(plan.query).some(id => targets.includes(id)) && (previews.has(JSON.stringify(plan)) || (!completed.has(JSON.stringify(plan)) && completed.size < 24));
      const groups = [plans.filter(plan => plan.query.genreId), plans.filter(plan => plan.query.authorId), plans.filter(plan => plan.query.languageId && !plan.query.genreId), plans.filter(plan => plan.query.subjectId)];
      const next = groups.map(group => group.find(pending)).filter((plan): plan is typeof plans[number] => !!plan);
      if (!next.length) break;
      for (const plan of next) await expand(plan);
    }
    if (remaining <= 0) partial = true;
    const response = this.assemble(library, seeds, [...candidates.values()], partial, activeUntil, client.traceID);
    response.categoryStates = Object.fromEntries(targets.map(id => [id, {
      state: failures.has(id) || (partial && !attempted.has(id)) ? "error" : response.pools?.some(row => row.id === id && row.books.length) ? "ready" : "empty",
      generatedAt: response.generatedAt, refreshAfter: response.refreshAfter!, expiresAt: response.expiresAt,
      ...(failures.has(id) ? { errorCode: failures.get(id) } : {}),
    } as CategoryState]));
    if (!response.catalogs.length && partial) throw new CatalogError("PROVIDER_UNAVAILABLE");
    return response;
  }

  private assemble(library: LibrarySignal[], seeds: CatalogBook[], candidates: CatalogBook[], partial: boolean, activeUntil: number, traceID?: string): CatalogBuildResult {
    const preferences = new Map<string, number>();
    const profile = metadataProfile(library);
    library.filter(positiveSignal).forEach(b => {
      specific([...b.genres, ...b.subjects]).forEach(value => {
        const key = normalize(value);
        preferences.set(key, (preferences.get(key) ?? 0) + 1 + Number(b.favorite) * 2 + (b.rating >= 4 ? 1 : 0));
      });
    });
    const owned = new CatalogIdentityIndex([...library, ...seeds]);
    const distinct = new CatalogIdentityIndex();
    const ranked = candidates.filter(book => {
      if (book.language !== "eng" || owned.has(book) || distinct.has(book)) return false;
      distinct.add(book); return true;
    }).map(book => {
      const match = similarity(book, seeds);
      const profileMatch = profileSimilarity(book, profile);
      const strongest = profileMatch.score > match.score ? { ...profileMatch, authors: match.authors } : match;
      const authors = book.authorIDs.filter(id => seeds.some(seed => seed.authorIDs.includes(id))).length;
      const preferenceBonus = Math.min(4, specific([...book.genres, ...book.subjects]).reduce((sum, v) => sum + (preferences.get(normalize(v)) ?? 0), 0));
      return { book, ...strongest, authors, score: strongest.score > 0 ? strongest.score + preferenceBonus : 0 };
    })
      .sort((a, b) => b.score - a.score || a.book.id.localeCompare(b.book.id));
    const knownAuthors = new Set(seeds.flatMap(s => s.authorIDs));
    const libraryAuthors = new Set(library.filter(positiveSignal).flatMap(book => authorKeys(book.author)));
    const usedIDs = new Set<string>();
    const usedKeys = new Set<string>();
    const catalogs: AutomaticCatalog[] = [];
    const pools: AutomaticCatalog[] = [];
    const eligibleByCatalog = new Map<string, typeof ranked>();
    const sectionCounts = new Map<string, number>();
    const add = (id: string, title: string, predicate: (item: typeof ranked[number]) => boolean) => {
      pools.push({ id, title, books: ranked.filter(predicate).slice(0, 18).map(item => item.book) });
      const eligible = ranked.filter(item => predicate(item) && !usedIDs.has(item.book.id) && !usedKeys.has(bookKey(item.book.title, item.book.author)));
      sectionCounts.set(id, eligible.length);
      if (eligible.length < 2) return;
      const books = eligible.slice(0, 2).map(item => item.book);
      eligibleByCatalog.set(id, ranked.filter(predicate));
      books.forEach(book => { usedIDs.add(book.id); usedKeys.add(bookKey(book.title, book.author)); });
      catalogs.push({ id, title, books });
    };
    // Reserve each viable section's minimum before filling rows, so the first
    // broad predicate cannot consume every book available to the other sections.
    add("authors-read", "More From Authors You Read", r => r.authors > 0);
    add("new-authors", "Discover New Authors", r => r.score >= 8 && r.book.authorIDs.every(id => !knownAuthors.has(id))
      && (r.book.authorNames ?? [r.book.author]).every(author => authorKeys(author).every(key => !libraryAuthors.has(key))));
    add("similar", "You Might Also Like", r => r.score >= 10 && r.subjects + r.genres >= 2);
    add("themes", "Explore Similar Themes", r => r.subjects >= 2);
    add("genres", "Based on Your Favorite Genres", r => r.genres >= 1 && r.score >= 6);
    add("related", "Related Books", r => r.subjects >= 1 && r.genres >= 1 && r.score >= 8);
    add("discovery", "Discover Something New", r => r.subjects >= 1 || r.genres >= 2);
    for (let slot = 2; slot < 6; slot++) {
      for (const catalog of catalogs) {
        const next = eligibleByCatalog.get(catalog.id)?.find(item => !usedIDs.has(item.book.id) && !usedKeys.has(bookKey(item.book.title, item.book.author)));
        if (next) {
          catalog.books.push(next.book);
          usedIDs.add(next.book.id); usedKeys.add(bookKey(next.book.title, next.book.author));
        }
      }
    }
    const order = ["similar", "genres", "themes", "new-authors", "authors-read", "related", "discovery"];
    catalogs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    if (traceID) {
      for (const id of order) {
        const showing = catalogs.find(catalog => catalog.id === id)?.books.length ?? 0;
        catalogLog("catalog.section", { id, eligible: sectionCounts.get(id) ?? 0, showing, reason: showing ? "ranked" : "insufficient_qualifying_english_books" }, traceID);
      }
    }
    return { catalogs: allocateCatalogs(catalogs, library), pools, generatedAt: new Date().toISOString(), refreshAfter: new Date(Math.min(Date.now() + (partial ? 300_000 : 3_600_000), activeUntil)).toISOString(), expiresAt: new Date(Math.min(Date.now() + 86_400_000, activeUntil)).toISOString(), partial };
  }
}

function refsForSeed(seed: CatalogBook) {
  const plans: { collection: string; query: Record<string, string> }[] = [];
  const usedSubjects = new Set<string>();
  seed.subjectIDs.filter((_, index) => {
    const key = specificSubjects([seed.subjects[index] ?? ""])[0];
    if (!key || usedSubjects.has(key)) return false;
    usedSubjects.add(key);
    return true;
  }).slice(0, 3)
    .forEach(subjectId => plans.push({ collection: "books", query: { subjectId } }));
  seed.genreIDs.filter((_, index) => specific([seed.genres[index] ?? ""]).length > 0).slice(0, 2)
    .forEach(genreId => plans.push({ collection: "editions", query: { genreId } }));
  seed.authorIDs.slice(0, 2).forEach(authorId => plans.unshift({ collection: "books", query: { authorId } }));
  return plans;
}

export const bookDatabaseClient = new BookDatabaseClient();
export const automaticCatalogService = new AutomaticCatalogService(bookDatabaseClient,
  mongoCatalogStore(digest(process.env.BOOKDATABASE_API_KEY ?? "unconfigured")));
