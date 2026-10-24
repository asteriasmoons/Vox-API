import { authorKeys, catalogBook, distinct, mergeBooks, ownedMatches, sameBook } from "./normalization";
import { RecommendationStore } from "./repository";
import { Book, CatalogResponse, CategoryID, CategoryState, categoryIDs, categoryTitles, ENGINE_VERSION, LibraryBook } from "./types";

export const RETENTION = 7 * 86400000;
export type CategoryRecord = CategoryState & { ids: string[]; ownership: string };
export class RecommendationCatalogCache {
  constructor(readonly store: RecommendationStore) {}
  rowKey(profile: string, id: string) { return `${ENGINE_VERSION}:category:${profile}:${id}`; }
  async saveBook(book: Book) {
    if (book.sources.includes("bookdatabase.io")) throw new Error("Licensed supplements must be stored separately");
    const aliases = distinct([book.id, ...(book.knowledgeWorkIDs ?? []), ...(book.providerIDs.hardcover ?? []).map(id => `hc_${id}`), ...(book.providerIDs["google-books"] ?? []).map(id => `gb_${id}`), ...(book.providerIDs["open-library"] ?? []).filter(id => /W$/.test(id)).map(id => `ol_${id}`)]);
    await Promise.all(aliases.map(id => this.store.set(`book:${id}`, book, RETENTION)));
  }
  async book(id: string, allowLicensed: boolean): Promise<Book | null> {
    const base = await this.store.get<Book>(`book:${id}`);
    if (!base) return null;
    if (!allowLicensed) return base;
    const supplement = await this.store.get<Book>(`licensed:${base.id}`);
    if (!supplement || Date.parse(supplement.metadataExpiresAt ?? "") <= Date.now()) return base;
    return mergeBooks(base, supplement);
  }
  async read(profile: string, library: LibraryBook[], allowLicensed: boolean): Promise<{ response: CatalogResponse; records: Map<CategoryID, CategoryRecord>; pools: Map<CategoryID, Book[]> }> {
    const records = new Map<CategoryID, CategoryRecord>();
    const pools = new Map<CategoryID, Book[]>();
    const memo = new Map<string, Promise<Book | null>>();
    await Promise.all(categoryIDs.map(async id => {
      const record = await this.store.get<CategoryRecord>(this.rowKey(profile, id));
      if (!record || Date.parse(record.expiresAt) <= Date.now()) return;
      records.set(id, record);
      const books = await Promise.all(record.ids.map(key => {
        if (!memo.has(key)) memo.set(key, this.book(key, allowLicensed));
        return memo.get(key)!;
      }));
      const distinctBooks: Book[] = [];
      for (const book of books) {
        if (!book || book.language !== "eng" || !book.authors.length || !book.title || (!book.coverUrls.length && !book.imageID) || library.some(owned => ownedMatches(owned, book)) || distinctBooks.some(previous => sameBook(previous, book))) continue;
        distinctBooks.push(book);
      }
      pools.set(id, distinctBooks);
    }));
    const selected = allocateSections(pools);
    const times = [...records.values()];
    const now = new Date().toISOString();
    const latest = (values: string[]) => values.sort().slice(-1)[0];
    const response: CatalogResponse = { catalogs: categoryIDs.flatMap(id => {
      const books = selected.get(id) ?? [];
      const state = records.get(id);
      return books.length && state ? [{ id, title: categoryTitles[id], books: books.map(catalogBook), generatedAt: state.generatedAt, refreshAfter: state.refreshAfter, expiresAt: state.expiresAt, state: state.state }] : [];
    }), generatedAt: latest(times.map(row => row.generatedAt)) ?? now,
      refreshAfter: times.map(row => row.refreshAfter).sort()[0] ?? now, expiresAt: latest(times.map(row => row.expiresAt)) ?? new Date(Date.now() + RETENTION).toISOString(),
      partial: records.size < categoryIDs.length || times.some(row => row.state === "stale" || row.state === "error"),
      categoryStates: Object.fromEntries([...records].map(([id, { ids, ownership, ...state }]) => [id, state])),
      engineVersion: ENGINE_VERSION, disabledSources: allowLicensed ? [] : ["bookdatabase.io"] };
    return { response, records, pools };
  }
  async write(profile: string, id: CategoryID, books: Book[], ownership: string, failed: boolean, final: boolean) {
    const key = this.rowKey(profile, id);
    const previous = await this.store.get<CategoryRecord>(key);
    if (!final && books.length < 2) return;
    const now = Date.now();
    // A refresh failure neither deletes previous results nor renews their hard retention deadline.
    if (failed && !books.length && previous) {
      await this.store.set(key, { ...previous, state: previous.ids.length ? "stale" : "error", refreshAfter: new Date(now + 300000).toISOString(), errorCode: "PROVIDER_UNAVAILABLE" }, Date.parse(previous.expiresAt) - now);
      return;
    }
    const ids = distinct([...books.map(book => book.id), ...(!final || failed ? previous?.ids ?? [] : [])]).slice(0, 64);
    const record: CategoryRecord = { ids, ownership, state: failed ? ids.length ? "stale" : "error" : ids.length ? "ready" : "empty",
      generatedAt: new Date(now).toISOString(), refreshAfter: new Date(now + (!final || failed ? 300000 : 6 * 3600000)).toISOString(), expiresAt: new Date(now + RETENTION).toISOString(),
      ...(failed ? { errorCode: "PROVIDER_UNAVAILABLE" } : {}) };
    await this.store.set(key, record, RETENTION);
  }
}

export function allocateSections(pools: Map<CategoryID, Book[]>): Map<CategoryID, Book[]> {
  const selected = new Map<CategoryID, Book[]>();
  const used: Book[] = [];
  const authorCounts = new Map<string, number>();
  const take = (id: CategoryID): boolean => {
    const next = (pools.get(id) ?? []).find(book => !used.some(previous => sameBook(previous, book)) && (authorCounts.get(authorKeys(book.authors[0] ?? "")[0] ?? "") ?? 0) < 5);
    if (!next) return false;
    selected.set(id, [...(selected.get(id) ?? []), next]); used.push(next);
    const author = authorKeys(next.authors[0] ?? "")[0] ?? "";
    authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
    return true;
  };
  // Reserve narrow rows before broad rows and round-robin remaining cards.
  const order: CategoryID[] = ["authors-read", "related", "themes", "genres", "new-authors", "similar", "discovery"];
  for (const id of order) {
    const available = (pools.get(id) ?? []).filter(book => !used.some(previous => sameBook(previous, book)));
    if (available.length < 2) continue;
    take(id); take(id);
  }
  for (let slot = 2; slot < 6; slot++) for (const id of order) if (selected.has(id)) take(id);
  for (const [id, books] of selected) if (books.length < 2) selected.delete(id);
  return selected;
}
