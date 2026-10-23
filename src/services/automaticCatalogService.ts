import { BookDatabaseClient, Reference, Resource, refs } from "./bookDatabaseClient";
import { CatalogError, CatalogStore, digest, mongoCatalogStore } from "./automaticCatalogStore";
import { randomUUID } from "node:crypto";
import { catalogFailure, catalogLog } from "./catalogDiagnostics";

export type LibrarySignal = {
  id: string; title: string; author: string; isbn?: string; genres: string[]; subjects: string[];
  rating: number; favorite: boolean; status: string; activity: number;
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
};
export type AutomaticCatalog = { id: string; title: string; books: CatalogBook[] };
export type CatalogResponse = { catalogs: AutomaticCatalog[]; generatedAt: string; expiresAt: string; partial: boolean; traceID?: string };
export type CatalogJobResponse = CatalogResponse & { state: "building" | "ready" | "failed"; errorCode?: string; retryAfter?: number };
const catalogKey = (library: LibrarySignal[]) => `catalog-v9-english-expanded:${digest(JSON.stringify(library))}`;
export const normalize = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const bookKey = (title: string, author: string) => `${normalize(title)}|${normalize(author)}`;
export const normalizeISBN = (s: string) => s.replace(/[^\dX]/gi, "").toUpperCase();
export function canonicalISBN(s: string): string {
  const isbn = normalizeISBN(s);
  if (isbn.length !== 10) return isbn;
  const prefix = `978${isbn.slice(0, 9)}`;
  const check = (10 - [...prefix].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10;
  return prefix + check;
}
export function validISBN(value: string): boolean {
  const s = normalizeISBN(value);
  if (/^\d{13}$/.test(s)) return [...s].reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0;
  return /^\d{9}[\dX]$/.test(s) && [...s].reduce((sum, c, i) => sum + (c === "X" ? 10 : Number(c)) * (10 - i), 0) % 11 === 0;
}
export function matchesIdentity(seed: Pick<LibrarySignal, "title" | "author">, candidate: Resource): boolean {
  return normalize(seed.title) === normalize(candidate.title ?? "") && !!normalize(seed.author) &&
    refs(candidate, "authors").some(author => normalize(author.name ?? "") === normalize(seed.author));
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

export function parseLibrary(body: any): LibrarySignal[] {
  if (!body || !Array.isArray(body.books) || body.books.length > 1000) throw new CatalogError("INVALID_LIBRARY", 400);
  const text = (value: unknown, max = 256) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const strings = (value: unknown) => Array.isArray(value) ? value.filter(v => typeof v === "string").slice(0, 20).map(v => text(v)) : [];
  return body.books.map((book: any) => {
    if (!book || !text(book.id) || !text(book.title) || !text(book.author)) throw new CatalogError("INVALID_BOOK", 400);
    return { id: text(book.id), title: text(book.title, 512), author: text(book.author), isbn: text(book.isbn, 32),
      genres: strings(book.genres), subjects: strings(book.subjects),
      rating: typeof book.rating === "number" ? Math.min(5, Math.max(0, book.rating)) : 0,
      favorite: book.favorite === true, status: text(book.status, 40),
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

  async requestCatalogs(library: LibrarySignal[], forceRefresh = false, traceID = randomUUID()): Promise<CatalogJobResponse> {
    const activeUntil = await this.client.assertActive();
    const key = catalogKey(library);
    const jobKey = `job:${key}`;
    const previous = await this.store.get(jobKey) as CatalogJobResponse | undefined;
    if (previous?.state === "building" || (previous?.state === "failed" && !forceRefresh)) {
      catalogLog("job.resume", { state: previous.state, catalogs: previous.catalogs.length }, previous.traceID ?? traceID);
      return previous;
    }
    const cached = await this.store.get(key) as CatalogResponse | undefined;
    if (cached && !forceRefresh) { catalogLog("job.cache_hit", { catalogs: cached.catalogs.length }, traceID); return { ...cached, state: "ready" }; }
    if (previous && !forceRefresh) return previous;
    const expiresAt = new Date(Math.min(Date.now() + this.buildTimeoutMs + 15_000, activeUntil));
    let snapshot: CatalogJobResponse = {
      catalogs: [], generatedAt: new Date().toISOString(), expiresAt: expiresAt.toISOString(),
      partial: true, state: "building", retryAfter: 4, traceID,
    };
    const owner = randomUUID();
    if (!await this.store.claim(jobKey, owner, this.buildTimeoutMs + 30_000)) return previous ?? snapshot;
    try { await this.store.set(jobKey, snapshot, expiresAt); }
    catch (error) { await this.store.release(jobKey, owner); throw error; }
    // The existing server process completes the metadata fetch; HTTP callers only read snapshots.
    catalogLog("job.start", { libraryBooks: library.length, maxSeeds: 12, maxCandidates: 64, maxPlans: 24, deadlineMs: this.buildTimeoutMs }, traceID);
    void this.catalogs(library, async response => {
      snapshot = { ...response, state: "building", retryAfter: 4, traceID };
      await this.store.set(jobKey, snapshot, expiresAt);
    }, forceRefresh, traceID).then(async response => {
      catalogLog("job.ready", { catalogs: response.catalogs.map(c => ({ id: c.id, books: c.books.length })), partial: response.partial }, traceID);
      await this.store.set(jobKey, { ...response, state: "ready", traceID }, new Date(response.expiresAt));
    }).catch(async (error: unknown) => {
      const failure = error instanceof CatalogError ? error : new CatalogError("CATALOG_UNAVAILABLE");
      catalogLog("job.failed", catalogFailure(error), traceID);
      if (["PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(failure.code)) snapshot = { ...snapshot, catalogs: [] };
      await this.store.set(jobKey, { ...snapshot, state: "failed", errorCode: failure.code }, new Date(Date.now() + 30_000));
    }).finally(() => this.store.release(jobKey, owner)).catch(() => {
      console.warn("Automatic catalog job storage unavailable");
    });
    return snapshot;
  }

  async catalogs(library: LibrarySignal[], publish?: (response: CatalogResponse) => Promise<void>, forceRefresh = false, traceID = randomUUID()): Promise<CatalogResponse> {
    const activeUntil = await this.client.assertActive();
    // Periodic maintenance validates subscription access without blocking cached catalogs.
    const key = catalogKey(library);
    const cached = await this.store.get(key) as CatalogResponse | undefined;
    if (cached && !forceRefresh) return cached;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new CatalogError("CATALOG_TIMED_OUT", 504, 30)), this.buildTimeoutMs);
    const pending = this.build(library, activeUntil, this.client.withSignal(controller.signal, traceID), publish).then(async result => {
      result = { ...result, traceID };
      // Personal signals are never stored; only a hashed key and expiring output.
      await this.store.set(key, result, new Date(result.expiresAt)); return result;
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
    if (!linkedEditions.length) {
      // Some documented compound filters stall upstream. Fall back to the work's
      // editions, but require the same language relationship on every record.
      const queries = [{ bookId: id, languageId: languageID }, { bookId: id }];
      for (const query of queries) {
        try {
          const bounded = client.withTimeout?.(6500) ?? client;
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
    const authors = refs(work, "authors").length ? refs(work, "authors") : edition ? refs(edition, "authors") : [];
    if (!work.id || !work.title?.trim() || names(authors).length === 0) return null;
    const isbn = edition?.isbns?.filter(validISBN).map(normalizeISBN).sort((a, b) => b.length - a.length)[0] ?? null;
    const genres = namedRefs(edition ? refs(edition, "genres") : []);
    const subjects = namedRefs(refs(work, "subjects"));
    const imageID = (englishLanguageID ? (edition ? refs(edition, "images")[0]?.id : undefined) : refs(work, "images")[0]?.id) ?? null;
    const title = englishLanguageID ? edition!.title!.trim() : work.title.trim();
    const sameTitle = normalize(title) === normalize(work.title);
    return { id: work.id, title, author: names(authors).join(", "),
      summary: edition?.description?.trim() || (sameTitle ? work.description?.trim() : "") || "", subtitle: edition?.subtitle ?? (sameTitle ? work.subtitle : null) ?? null,
      isbn, pages: edition?.pageCount ?? null, publisher: edition ? names(refs(edition, "publishers"))[0] ?? null : null,
      releaseYear: null, coverUrl: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : null, imageID,
      genres: names(genres), subjects: names(subjects), authorIDs: authors.map(a => a.id), authorNames: names(authors),
      subjectIDs: subjects.map(s => s.id), genreIDs: genres.map(g => g.id), source: "bookdatabase.io",
      languageIDs: edition ? refs(edition, "languages").map(language => language.id) : [], ...(englishLanguageID ? { language: "eng" } : {}) };
  }

  async match(seed: LibrarySignal, client = this.client): Promise<CatalogBook | null> {
    if (seed.isbn && validISBN(seed.isbn)) {
      const editions = await client.page("editions", { isbn: normalizeISBN(seed.isbn), includeRelationships: "All", pageSize: "3" });
      const edition = editions.find(e => (e.isbns ?? []).some(i => canonicalISBN(i) === canonicalISBN(seed.isbn!)));
      const works = edition ? refs(edition, "books") : [];
      if (edition && works.length === 1) {
        const work = await client.get(path("books", works[0]!.id));
        if (work && matchesIdentity(seed, work)) return this.map(work, edition);
      }
    }
    let workSearchError: unknown;
    try {
      const results = await client.page("books", { searchQuery: seed.title.slice(0, 128), searchMode: "Exact", sortOrder: "SearchRelevanceDescending", includeRelationships: "None", pageSize: "3" });
      const works: Resource[] = [];
      for (const result of results) {
        if (normalize(result.title ?? "") !== normalize(seed.title)) continue;
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
    const results = await client.page("editions", { searchQuery: seed.title.slice(0, 128), searchMode: "Exact", sortOrder: "SearchRelevanceDescending", includeRelationships: "None", pageSize: "3" });
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

  private async build(library: LibrarySignal[], activeUntil: number, client: BookDatabaseClient, publish?: (response: CatalogResponse) => Promise<void>): Promise<CatalogResponse> {
    let partial = false;
    let exhausted = false;
    let remaining = 64;
    let englishLanguageID: string | undefined;
    const seedPriority = (b: LibrarySignal) => Number(b.favorite) * 20 + b.rating * 3 + Math.log1p(b.activity)
      + (b.status === "Reading" ? 6 : b.status === "Finished" ? 4 : 0);
    const rankedSignals = [...library].filter(b => !["did not finish", "archived"].includes(b.status.toLowerCase()) && !(b.rating > 0 && b.rating < 3))
      .sort((a, b) => seedPriority(b) - seedPriority(a));
    const representedAuthors = new Set<string>();
    const firstByAuthor = rankedSignals.filter(book => {
      const key = normalize(book.author);
      if (representedAuthors.has(key)) return false;
      representedAuthors.add(key); return true;
    });
    const seedSignals = [...firstByAuthor, ...rankedSignals.filter(book => !firstByAuthor.includes(book))].slice(0, 12);
    catalogLog("discovery.profile", { libraryBooks: library.length, eligibleBooks: rankedSignals.length, seedBooks: seedSignals.length, authors: representedAuthors.size,
      genres: unique(library.flatMap(book => book.genres)).length, subjects: unique(library.flatMap(book => book.subjects)).length }, client.traceID);
    const seeds: CatalogBook[] = [];
    const candidates = new Map<string, CatalogBook>();
    const excludedKeys = new Set(library.map(b => bookKey(b.title, b.author)));
    const excludedISBNs = new Set(library.map(b => canonicalISBN(b.isbn ?? "")).filter(Boolean));
    const excludedIDs = new Set<string>();
    const plans: { collection: string; query: Record<string, string> }[] = [];
    const completed = new Set<string>();
    const previews = new Set<string>();
    const hydratedWorks = new Map<string, CatalogBook | null>();
    const expand = async (plan: typeof plans[number], preview = false) => {
      const key = JSON.stringify(plan);
      if (exhausted || (completed.has(key) && (preview || !previews.has(key))) || (!completed.has(key) && completed.size >= 24) || remaining <= 0 || !englishLanguageID) return;
      completed.add(key);
      if (preview) previews.add(key); else previews.delete(key);
      const query = plan.collection === "editions" ? { ...plan.query, languageId: englishLanguageID } : plan.query;
      catalogLog("discovery.plan_start", { collection: plan.collection, query, plan: completed.size, preview, candidateBudget: remaining }, client.traceID);
      try {
        let accepted = 0;
        const pages = async function* () {
          let yielded = false;
          try {
            const bounded = client.withTimeout?.(6500) ?? client;
            for await (const results of bounded.pages(plan.collection, { ...query, includeRelationships: "None", pageSize: "12" }, preview ? 1 : 3)) {
              yielded = true;
              yield results;
            }
          } catch (error) {
            if (yielded || plan.collection !== "editions" || (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED", "CATALOG_TIMED_OUT"].includes(error.code))) throw error;
            catalogLog("discovery.language_filter_fallback", { query: plan.query, ...catalogFailure(error) }, client.traceID);
            const bounded = client.withTimeout?.(6500) ?? client;
            yield* bounded.pages(plan.collection, { ...plan.query, includeRelationships: "None", pageSize: "12" }, preview ? 1 : 3);
          }
        };
        for await (const results of pages()) {
          for (const result of results) {
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
              if (mapped && !excludedKeys.has(bookKey(mapped.title, mapped.author)) && !(mapped.isbn && excludedISBNs.has(canonicalISBN(mapped.isbn)))) {
                candidates.set(id, mapped);
                catalogLog("candidate.accepted", { workID: id, language: mapped.language, genres: mapped.genres.length, subjects: mapped.subjects.length, totalCandidates: candidates.size }, client.traceID);
                if (mapped.metadataIncomplete) partial = true;
                accepted++;
                if (publish && candidates.size >= 2) await publish(this.assemble(library, seeds, [...candidates.values()], true, activeUntil));
              }
            }
            if (remaining <= 0 || accepted >= (preview ? 2 : 8)) break;
          }
          if (remaining <= 0 || accepted >= (preview ? 2 : 8)) break;
        }
        catalogLog("discovery.plan_complete", { collection: plan.collection, query, accepted, totalCandidates: candidates.size }, client.traceID);
      } catch (error) {
        if (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error.code)) throw error;
        catalogLog("discovery.plan_failed", { collection: plan.collection, query, ...catalogFailure(error) }, client.traceID);
        partial = true;
        if (error instanceof CatalogError && error.code === "CATALOG_TIMED_OUT") {
          if (candidates.size < 2) throw error;
          exhausted = true;
        }
      }
    };
    // Publish useful results from the first matched seed while matching the rest continues.
    for (const signal of seedSignals) {
      try {
        catalogLog("seed.match_start", { seed: seedSignals.indexOf(signal) + 1, identity: digest(bookKey(signal.title, signal.author)).slice(0, 12), hasISBN: !!signal.isbn }, client.traceID);
        const book = await this.match(signal, client);
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
          const preview = refsForSeed(book).find(plan => plan.query[kind] && !completed.has(JSON.stringify(plan)));
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
    if (!seeds.length && partial) throw new CatalogError("PROVIDER_UNAVAILABLE");
    // Interleave classifications so author queries cannot consume the entire discovery budget.
    const groups = [plans.filter(plan => plan.query.genreId), plans.filter(plan => plan.query.subjectId), plans.filter(plan => plan.query.authorId)];
    for (let index = 0; groups.some(group => index < group.length); index++) {
      for (const group of groups) { const plan = group[index]; if (plan) await expand(plan); }
    }
    if (remaining <= 0) partial = true;
    const response = this.assemble(library, seeds, [...candidates.values()], partial, activeUntil, client.traceID);
    if (!response.catalogs.length && partial) throw new CatalogError("PROVIDER_UNAVAILABLE");
    return response;
  }

  private assemble(library: LibrarySignal[], seeds: CatalogBook[], candidates: CatalogBook[], partial: boolean, activeUntil: number, traceID?: string): CatalogResponse {
    const preferences = new Map<string, number>();
    library.filter(b => !["did not finish", "archived"].includes(b.status.toLowerCase()) && !(b.rating > 0 && b.rating < 3)).forEach(b => {
      specific([...b.genres, ...b.subjects]).forEach(value => {
        const key = normalize(value);
        preferences.set(key, (preferences.get(key) ?? 0) + 1 + Number(b.favorite) * 2 + (b.rating >= 4 ? 1 : 0));
      });
    });
    const ranked = candidates.filter(book => book.language === "eng").map(book => {
      const match = similarity(book, seeds);
      const preferenceBonus = Math.min(4, specific([...book.genres, ...book.subjects]).reduce((sum, v) => sum + (preferences.get(normalize(v)) ?? 0), 0));
      return { book, ...match, score: match.score > 0 ? match.score + preferenceBonus : 0 };
    })
      .sort((a, b) => b.score - a.score || a.book.id.localeCompare(b.book.id));
    const knownAuthors = new Set(seeds.flatMap(s => s.authorIDs));
    const libraryAuthors = new Set(library.map(book => normalize(book.author)));
    const usedIDs = new Set<string>();
    const usedKeys = new Set<string>();
    const catalogs: AutomaticCatalog[] = [];
    const eligibleByCatalog = new Map<string, typeof ranked>();
    const sectionCounts = new Map<string, number>();
    const add = (id: string, title: string, predicate: (item: typeof ranked[number]) => boolean) => {
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
      && (r.book.authorNames ?? [r.book.author]).every(author => !libraryAuthors.has(normalize(author))));
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
    return { catalogs, generatedAt: new Date().toISOString(), expiresAt: new Date(Math.min(Date.now() + (partial ? 300_000 : 3_600_000), activeUntil)).toISOString(), partial };
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
