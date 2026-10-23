import { BookDatabaseClient, Reference, Resource, refs } from "./bookDatabaseClient";
import { CatalogError, CatalogStore, digest, mongoCatalogStore } from "./automaticCatalogStore";
import { randomUUID } from "node:crypto";

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
};
export type AutomaticCatalog = { id: string; title: string; books: CatalogBook[] };
export type CatalogResponse = { catalogs: AutomaticCatalog[]; generatedAt: string; expiresAt: string; partial: boolean };
export type CatalogJobResponse = CatalogResponse & { state: "building" | "ready" | "failed"; errorCode?: string; retryAfter?: number };
const catalogKey = (library: LibrarySignal[]) => `catalog-v7:${digest(JSON.stringify(library))}`;
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
  constructor(private client: BookDatabaseClient, private store: CatalogStore, private buildTimeoutMs = 120_000) {}

  async requestCatalogs(library: LibrarySignal[], forceRefresh = false): Promise<CatalogJobResponse> {
    const activeUntil = await this.client.assertActive();
    const key = catalogKey(library);
    const jobKey = `job:${key}`;
    const previous = await this.store.get(jobKey) as CatalogJobResponse | undefined;
    if (previous?.state === "building" || (previous?.state === "failed" && !forceRefresh)) return previous;
    const cached = await this.store.get(key) as CatalogResponse | undefined;
    if (cached && !forceRefresh) return { ...cached, state: "ready" };
    if (previous && !forceRefresh) return previous;
    const expiresAt = new Date(Math.min(Date.now() + this.buildTimeoutMs + 15_000, activeUntil));
    let snapshot: CatalogJobResponse = {
      catalogs: [], generatedAt: new Date().toISOString(), expiresAt: expiresAt.toISOString(),
      partial: true, state: "building", retryAfter: 4,
    };
    const owner = randomUUID();
    if (!await this.store.claim(jobKey, owner, this.buildTimeoutMs + 30_000)) return previous ?? snapshot;
    try { await this.store.set(jobKey, snapshot, expiresAt); }
    catch (error) { await this.store.release(jobKey, owner); throw error; }
    // The existing server process completes the metadata fetch; HTTP callers only read snapshots.
    void this.catalogs(library, async response => {
      snapshot = { ...response, state: "building", retryAfter: 4 };
      await this.store.set(jobKey, snapshot, expiresAt);
    }, forceRefresh).then(async response => {
      await this.store.set(jobKey, { ...response, state: "ready" }, new Date(response.expiresAt));
    }).catch(async (error: unknown) => {
      const failure = error instanceof CatalogError ? error : new CatalogError("CATALOG_UNAVAILABLE");
      if (["PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(failure.code)) snapshot = { ...snapshot, catalogs: [] };
      await this.store.set(jobKey, { ...snapshot, state: "failed", errorCode: failure.code }, new Date(Date.now() + 30_000));
    }).finally(() => this.store.release(jobKey, owner)).catch(() => {
      console.warn("Automatic catalog job storage unavailable");
    });
    return snapshot;
  }

  async catalogs(library: LibrarySignal[], publish?: (response: CatalogResponse) => Promise<void>, forceRefresh = false): Promise<CatalogResponse> {
    const activeUntil = await this.client.assertActive();
    // Periodic maintenance validates subscription access without blocking cached catalogs.
    const key = catalogKey(library);
    const cached = await this.store.get(key) as CatalogResponse | undefined;
    if (cached && !forceRefresh) return cached;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new CatalogError("CATALOG_TIMED_OUT", 504, 30)), this.buildTimeoutMs);
    const pending = this.build(library, activeUntil, this.client.withSignal(controller.signal), publish).then(async result => {
      // Personal signals are never stored; only a hashed key and expiring output.
      await this.store.set(key, result, new Date(result.expiresAt)); return result;
    });
    this.inFlight.set(key, pending);
    try { return await pending; } finally { clearTimeout(timer); this.inFlight.delete(key); }
  }

  async work(id: string, client = this.client): Promise<CatalogBook | null> {
    const resource: Resource | null = await client.get(path("books", id));
    if (!resource) return null;
    let edition: Resource | undefined;
    // Work responses already link their editions. Avoid another expanded result page.
    for (const reference of refs(resource, "editions").slice(0, 3)) {
      let value: Resource | null;
      try { value = await client.get(path("editions", reference.id)); }
      catch (error) {
        if (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error.code)) throw error;
        // A missing edition must not discard a usable work with real author/subject data.
        break;
      }
      if (value && refs(value, "books").some(book => book.id === id) && normalize(value.title ?? "") === normalize(resource.title ?? "")) {
        edition = value;
        break;
      }
    }
    const mapped = this.map(resource, edition);
    return mapped && !edition && refs(resource, "editions").length ? { ...mapped, metadataIncomplete: true } : mapped;
  }

  private map(work: Resource, edition?: Resource): CatalogBook | null {
    // ISBN relationships in live provider data can point to a different title.
    // Never attach that edition's metadata to an unrelated work.
    if (edition && (!refs(edition, "books").some(r => r.id === work.id) ||
      ![edition.title ?? "", ...(edition.alternateTitles ?? [])].some(title => normalize(title) === normalize(work.title ?? "")))) edition = undefined;
    const authors = refs(work, "authors").length ? refs(work, "authors") : edition ? refs(edition, "authors") : [];
    if (!work.id || !work.title?.trim() || names(authors).length === 0) return null;
    const isbn = edition?.isbns?.filter(validISBN).map(normalizeISBN).sort((a, b) => b.length - a.length)[0] ?? null;
    const genres = namedRefs(edition ? refs(edition, "genres") : []);
    const subjects = namedRefs(refs(work, "subjects"));
    const imageID = refs(work, "images")[0]?.id ?? (edition ? refs(edition, "images")[0]?.id : undefined) ?? null;
    return { id: work.id, title: work.title.trim(), author: names(authors).join(", "),
      summary: work.description?.trim() || edition?.description?.trim() || "", subtitle: work.subtitle ?? edition?.subtitle ?? null,
      isbn, pages: edition?.pageCount ?? null, publisher: edition ? names(refs(edition, "publishers"))[0] ?? null : null,
      releaseYear: null, coverUrl: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : null, imageID,
      genres: names(genres), subjects: names(subjects), authorIDs: authors.map(a => a.id), authorNames: names(authors),
      subjectIDs: subjects.map(s => s.id), genreIDs: genres.map(g => g.id), source: "bookdatabase.io" };
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
    let remaining = 22;
    const seedPriority = (b: LibrarySignal) => Number(b.favorite) * 20 + b.rating * 3 + Math.log1p(b.activity)
      + (b.status === "Reading" ? 6 : b.status === "Finished" ? 4 : 0);
    const seedSignals = [...library].filter(b => !["did not finish", "archived"].includes(b.status.toLowerCase()) && !(b.rating > 0 && b.rating < 3))
      .sort((a, b) => seedPriority(b) - seedPriority(a))
      .slice(0, 4);
    const seeds: CatalogBook[] = [];
    const candidates = new Map<string, CatalogBook>();
    const excludedKeys = new Set(library.map(b => bookKey(b.title, b.author)));
    const excludedISBNs = new Set(library.map(b => canonicalISBN(b.isbn ?? "")).filter(Boolean));
    const excludedIDs = new Set<string>();
    const plans: { collection: string; query: Record<string, string> }[] = [];
    const completed = new Set<string>();
    const expand = async (plan: typeof plans[number]) => {
      const key = JSON.stringify(plan);
      if (exhausted || completed.has(key) || completed.size >= 8 || remaining <= 0) return;
      completed.add(key);
      try {
        let accepted = 0;
        for await (const results of client.pages(plan.collection, { ...plan.query, includeRelationships: "None", pageSize: "6" }, 2)) {
          for (const result of results) {
            const edition: Resource | null = plan.collection === "editions" ? await client.get(path("editions", result.id)) : null;
            if (plan.collection === "editions" && !edition) continue;
            if (edition && plan.query.genreId && !refs(edition, "genres").some(genre => genre.id === plan.query.genreId)) continue;
            const workIDs = edition ? refs(edition, "books").map(r => r.id) : [result.id];
            for (const id of workIDs) {
              if (excludedIDs.has(id) || candidates.has(id) || remaining <= 0) continue;
              remaining--;
              let mapped: CatalogBook | null;
              if (plan.collection === "editions") {
                const work = await client.get(path("books", id));
                mapped = work ? this.map(work, edition ?? undefined) : null;
              } else {
                mapped = await this.work(id, client);
              }
              if (mapped && plan.query.authorId && !mapped.authorIDs.includes(plan.query.authorId)) continue;
              if (mapped && plan.query.subjectId && !mapped.subjectIDs.includes(plan.query.subjectId)) continue;
              if (mapped && !excludedKeys.has(bookKey(mapped.title, mapped.author)) && !(mapped.isbn && excludedISBNs.has(canonicalISBN(mapped.isbn)))) {
                candidates.set(id, mapped);
                if (mapped.metadataIncomplete) partial = true;
                accepted++;
                if (publish && candidates.size >= 2) await publish(this.assemble(library, seeds, [...candidates.values()], true, activeUntil));
              }
            }
            if (remaining <= 0 || accepted >= 4) break;
          }
          if (remaining <= 0 || accepted >= 4) break;
        }
      } catch (error) {
        if (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error.code)) throw error;
        console.warn("Automatic catalog provider failure:", { stage: "candidates", collection: plan.collection, code: error instanceof CatalogError ? error.code : "UNAVAILABLE" });
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
        const book = await this.match(signal, client);
        if (book && !seeds.some(s => s.id === book.id)) {
          seeds.push(book);
          if (book.metadataIncomplete) partial = true;
          excludedIDs.add(book.id);
          candidates.delete(book.id);
          refsForSeed(book).forEach(plan => {
            if (!plans.some(existing => JSON.stringify(existing) === JSON.stringify(plan))) plans.push(plan);
          });
          const authorPlan = refsForSeed(book).find(plan => plan.query.authorId);
          if (authorPlan) await expand(authorPlan);
        }
      } catch (error) {
        if (error instanceof CatalogError && ["PROVIDER_QUOTA_EXHAUSTED", "PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error.code)) throw error;
        console.warn("Automatic catalog provider failure:", { stage: "seed", code: error instanceof CatalogError ? error.code : "UNAVAILABLE" });
        partial = true;
        if (error instanceof CatalogError && error.code === "CATALOG_TIMED_OUT") {
          if (candidates.size < 2) throw error;
          break;
        }
      }
      if (exhausted) break;
    }
    if (!seeds.length && partial) throw new CatalogError("PROVIDER_UNAVAILABLE");
    for (const plan of plans) await expand(plan);
    if (remaining <= 0) partial = true;
    const response = this.assemble(library, seeds, [...candidates.values()], partial, activeUntil);
    if (!response.catalogs.length && partial) throw new CatalogError("PROVIDER_UNAVAILABLE");
    return response;
  }

  private assemble(library: LibrarySignal[], seeds: CatalogBook[], candidates: CatalogBook[], partial: boolean, activeUntil: number): CatalogResponse {
    const preferences = new Map<string, number>();
    library.filter(b => !["did not finish", "archived"].includes(b.status.toLowerCase()) && !(b.rating > 0 && b.rating < 3)).forEach(b => {
      specific([...b.genres, ...b.subjects]).forEach(value => {
        const key = normalize(value);
        preferences.set(key, (preferences.get(key) ?? 0) + 1 + Number(b.favorite) * 2 + (b.rating >= 4 ? 1 : 0));
      });
    });
    const ranked = candidates.map(book => {
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
    const add = (id: string, title: string, predicate: (item: typeof ranked[number]) => boolean) => {
      const eligible = ranked.filter(item => predicate(item) && !usedIDs.has(item.book.id) && !usedKeys.has(bookKey(item.book.title, item.book.author)));
      if (eligible.length < 2) return;
      const books = eligible.slice(0, 6).map(item => item.book);
      books.forEach(book => { usedIDs.add(book.id); usedKeys.add(bookKey(book.title, book.author)); });
      catalogs.push({ id, title, books });
    };
    // Allocate specific relationships first; present the familiar discovery order below.
    add("authors-read", "More From Authors You Read", r => r.authors > 0);
    add("similar", "You Might Also Like", r => r.score >= 10 && r.subjects + r.genres >= 2);
    add("themes", "Explore Similar Themes", r => r.subjects >= 2);
    add("genres", "Based on Your Favorite Genres", r => r.genres >= 1 && r.score >= 6);
    add("new-authors", "Discover New Authors", r => r.score >= 8 && r.book.authorIDs.every(id => !knownAuthors.has(id))
      && (r.book.authorNames ?? [r.book.author]).every(author => !libraryAuthors.has(normalize(author))));
    add("related", "Related Books", r => r.subjects >= 1 && r.genres >= 1 && r.score >= 8);
    add("discovery", "Discover Something New", r => r.subjects >= 1 || r.genres >= 2);
    const order = ["similar", "genres", "themes", "new-authors", "authors-read", "related", "discovery"];
    catalogs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
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
  }).slice(0, 2)
    .forEach(subjectId => plans.push({ collection: "books", query: { subjectId } }));
  seed.genreIDs.filter((_, index) => specific([seed.genres[index] ?? ""]).length > 0).slice(0, 1)
    .forEach(genreId => plans.push({ collection: "editions", query: { genreId } }));
  seed.authorIDs.slice(0, 1).forEach(authorId => plans.unshift({ collection: "books", query: { authorId } }));
  return plans;
}

export const bookDatabaseClient = new BookDatabaseClient();
export const automaticCatalogService = new AutomaticCatalogService(bookDatabaseClient,
  mongoCatalogStore(digest(process.env.BOOKDATABASE_API_KEY ?? "unconfigured")));
