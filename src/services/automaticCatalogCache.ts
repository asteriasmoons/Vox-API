import type { AutomaticCatalog, CatalogResponse, LibrarySignal } from "./automaticCatalogService";
import { CatalogStore } from "./automaticCatalogStore";
import { CatalogIdentityIndex, cleanTitle } from "./catalogBookIdentity";

export const catalogTitles: Record<string, string> = {
  similar: "You Might Also Like", genres: "Based on Your Favorite Genres", themes: "Explore Similar Themes",
  "new-authors": "Discover New Authors", "authors-read": "More From Authors You Read", related: "Related Books", discovery: "Discover Something New",
};
export const catalogIDs = Object.keys(catalogTitles);
export type CategoryState = { state: "ready" | "empty" | "error" | "stale"; generatedAt: string; refreshAfter: string; expiresAt: string; errorCode?: string };
type PreparedCategory = CategoryState & { catalog: AutomaticCatalog };
export type CatalogBuildResult = CatalogResponse & { pools?: AutomaticCatalog[] };

export function allocateCatalogs(catalogs: AutomaticCatalog[], library: LibrarySignal[]): AutomaticCatalog[] {
  const owned = new CatalogIdentityIndex(library);
  const used = new CatalogIdentityIndex();
  const eligible = new Map<string, AutomaticCatalog>();
  for (const catalog of catalogs) {
    const local = new CatalogIdentityIndex();
    const books = catalog.books.filter(book => {
      if (!book.id || !book.title?.trim() || !book.author?.trim() || book.language !== "eng" || owned.has(book) || local.has(book)) return false;
      local.add(book); return true;
    }).map(book => ({ ...book, title: cleanTitle(book.title), author: book.author.trim() }));
    eligible.set(catalog.id, { ...catalog, books });
  }
  const result: AutomaticCatalog[] = [];
  // Reserve the minimum for each category before allowing a broad row to consume all results.
  for (const id of ["authors-read", "new-authors", "similar", "themes", "genres", "related", "discovery"]) {
    const source = eligible.get(id);
    const books = source?.books.filter(book => !used.has(book)).slice(0, 2) ?? [];
    if (!source || books.length < 2) continue;
    books.forEach(book => used.add(book));
    result.push({ ...source, books });
  }
  for (let slot = 2; slot < 6; slot++) for (const catalog of result) {
    const next = eligible.get(catalog.id)?.books.find(book => !used.has(book));
    if (next) { catalog.books.push(next); used.add(next); }
  }
  return result.sort((a, b) => catalogIDs.indexOf(a.id) - catalogIDs.indexOf(b.id));
}

export class PreparedCatalogCache {
  constructor(private store: CatalogStore, private profileKey: string) {}
  private key(id: string) { return `prepared-v1:${this.profileKey}:${id}`; }

  async read(library: LibrarySignal[], activeUntil: number, now = Date.now()): Promise<CatalogResponse> {
    const categories: AutomaticCatalog[] = [];
    const categoryStates: Record<string, CategoryState> = {};
    for (const id of catalogIDs) {
      const entry = await this.store.get(this.key(id)) as PreparedCategory | undefined;
      if (!entry || Date.parse(entry.expiresAt) <= now) continue;
      const { catalog, ...state } = entry;
      categoryStates[id] = { ...state, state: state.state === "ready" && Date.parse(state.refreshAfter) <= now ? "stale" : state.state };
      categories.push({ ...catalog, ...categoryStates[id] });
    }
    return {
      catalogs: allocateCatalogs(categories, library), categoryStates,
      generatedAt: new Date(now).toISOString(),
      refreshAfter: new Date(Math.min(now + 3_600_000, ...Object.values(categoryStates).map(state => Date.parse(state.refreshAfter)))).toISOString(),
      expiresAt: new Date(Math.min(activeUntil, Math.max(now, ...Object.values(categoryStates).map(state => Date.parse(state.expiresAt))) || now + 86_400_000)).toISOString(),
      partial: Object.values(categoryStates).some(state => ["stale", "error"].includes(state.state)),
    };
  }

  async write(result: CatalogBuildResult, targets: string[], final: boolean, activeUntil: number): Promise<void> {
    const now = Date.now();
    for (const id of targets) {
      const catalog = (result.pools ?? result.catalogs).find(row => row.id === id);
      const previous = await this.store.get(this.key(id)) as PreparedCategory | undefined;
      const outcome = result.categoryStates?.[id];
      if (!final && (catalog?.books.length ?? 0) < 2) continue;
      const failed = final && (outcome?.state === "error" || (!outcome && result.partial));
      if (failed && (catalog?.books.length ?? 0) < 2) {
        if (previous) {
          await this.store.set(this.key(id), { ...previous, state: "stale", refreshAfter: new Date(now + 300_000).toISOString(), errorCode: outcome?.errorCode ?? "PROVIDER_UNAVAILABLE" }, new Date(previous.expiresAt));
        } else {
          const expiry = new Date(Math.min(activeUntil, now + 300_000)).toISOString();
          await this.store.set(this.key(id), { catalog: { id, title: catalogTitles[id], books: [] }, state: "error", generatedAt: new Date(now).toISOString(), refreshAfter: expiry, expiresAt: expiry, errorCode: outcome?.errorCode ?? "PROVIDER_UNAVAILABLE" }, new Date(expiry));
        }
        continue;
      }
      const expiresAt = new Date(Math.min(activeUntil, now + 86_400_000)).toISOString();
      const entry: PreparedCategory = {
        catalog: { id, title: catalogTitles[id]!, books: catalog?.books.slice(0, 18) ?? [] },
        state: failed || !final ? "stale" : catalog?.books.length ? "ready" : "empty",
        generatedAt: new Date(now).toISOString(), refreshAfter: new Date(Math.min(activeUntil, now + (failed || !final ? 300_000 : 3_600_000))).toISOString(), expiresAt,
        ...(failed ? { errorCode: outcome?.errorCode ?? "PROVIDER_UNAVAILABLE" } : {}),
      };
      await this.store.set(this.key(id), entry, new Date(expiresAt));
    }
  }

  stale(response: CatalogResponse, requested = catalogIDs): string[] {
    return requested.filter(id => !response.categoryStates?.[id] || Date.parse(response.categoryStates[id]!.refreshAfter) <= Date.now());
  }
}
