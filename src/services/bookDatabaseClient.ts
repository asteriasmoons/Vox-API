import "dotenv/config";
import { randomUUID } from "node:crypto";
import { CatalogError, CatalogStore, delay, digest, mongoCatalogStore } from "./automaticCatalogStore";
import { catalogFailure, catalogLog, providerRequestFields } from "./catalogDiagnostics";

export type Reference = { id: string; name?: string; _link?: unknown; _links?: unknown };
export type Resource = {
  id: string; title?: string; name?: string; subtitle?: string; description?: string;
  about?: string; alternateNames?: string[];
  iso639Code?: string; englishName?: string;
  pageCount?: number; isbns?: string[]; publishDate?: string;
  alternateTitles?: string[];
  uris?: string[]; links?: { uri: string; title: string }[];
  _embedded?: Record<string, Reference[]>;
  _link?: Record<string, { href: string }>; _links?: Record<string, { href: string }>;
};
export const refs = (resource: Resource, relation: string): Reference[] => {
  const values = resource._embedded?.[relation];
  return Array.isArray(values) ? values.filter(r => r && typeof r.id === "string" && r.id.length > 0) : [];
};

export function safeImageURL(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || [...url.searchParams.keys()].some(key => key.toLowerCase() === "apikey")) return null;
    return url.href;
  } catch { return null; }
}
export const BASE = "https://api.bookdatabase.io/v1/";
export function providerURL(path: string): URL {
  const url = new URL(path.replace(/^\/v1\//, ""), BASE);
  if (url.origin !== new URL(BASE).origin || !url.pathname.startsWith("/v1/") || url.username || url.password)
    throw new CatalogError("INVALID_PROVIDER_LINK", 502);
  // Never forward a query-string credential or trust one supplied by a HAL link.
  url.searchParams.delete("apiKey");
  url.searchParams.sort();
  return url;
}
export function parsePage(value: any, collection: string): { items: Resource[]; next?: string } {
  const items = value?._embedded?.[collection];
  if (!Array.isArray(items)) throw new CatalogError("INVALID_PROVIDER_RESPONSE", 502);
  const next = (value._link ?? value._links)?.next?.href;
  return { items: items.filter((r: any) => r && typeof r.id === "string"), ...(typeof next === "string" ? { next } : {}) };
}

export function validateProviderPayload(value: any, url: URL): void {
  const segments = url.pathname.replace(/^\/v1\//, "").split("/").filter(Boolean);
  if (segments.length > 1) {
    if (typeof value.id !== "string") throw new CatalogError("INVALID_PROVIDER_RESPONSE", 502);
    if (segments[1] !== "random" && value.id !== decodeURIComponent(segments[1]!)) throw new CatalogError("PROVIDER_RESPONSE_MISMATCH", 502);
    return;
  }
  const collection = segments[0]!;
  const { items } = parsePage(value, collection);
  const relationships: Record<string, string> = { bookId: "books", authorId: "authors", genreId: "genres", subjectId: "subjects", languageId: "languages" };
  const words = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/);
  for (const item of items) {
    if (url.searchParams.get("includeRelationships") !== "None") {
      for (const [parameter, relation] of Object.entries(relationships)) {
        const id = url.searchParams.get(parameter);
        if (id && !refs(item, relation).some(r => r.id === id)) throw new CatalogError("PROVIDER_RESPONSE_MISMATCH", 502);
      }
    }
    const query = url.searchParams.get("searchQuery");
    if (query && url.searchParams.get("searchMode") !== "Fuzzy" && ["books", "editions"].includes(collection)) {
      const titles = [item.title ?? "", ...(item.alternateTitles ?? [])].map(words);
      if (!titles.some(title => words(query).every(word => title.includes(word)))) throw new CatalogError("PROVIDER_RESPONSE_MISMATCH", 502);
    }
  }
}

export class BookDatabaseClient {
  private inFlight = new Map<string, Promise<any>>();
  constructor(
    private key: () => string = () => process.env.BOOKDATABASE_API_KEY ?? "",
    private store: CatalogStore = mongoCatalogStore(digest(process.env.BOOKDATABASE_API_KEY ?? "unconfigured")),
    private transport: typeof fetch = fetch,
    private activeUntil: () => number = () => process.env.BOOKDATABASE_SUBSCRIPTION_EXPIRES_AT
      ? Date.parse(process.env.BOOKDATABASE_SUBSCRIPTION_EXPIRES_AT) : Infinity,
    private signal?: AbortSignal,
    private quota = { blockedUntil: 0 },
    readonly traceID?: string,
    private requestTimeoutMs = 15_000,
  ) {}

  withSignal(signal: AbortSignal, traceID = this.traceID): BookDatabaseClient {
    return new BookDatabaseClient(this.key, this.store, this.transport, this.activeUntil, signal, this.quota, traceID, this.requestTimeoutMs);
  }

  withTimeout(milliseconds: number): BookDatabaseClient {
    return new BookDatabaseClient(this.key, this.store, this.transport, this.activeUntil, this.signal, this.quota, this.traceID, milliseconds);
  }

  async assertActive(): Promise<number> {
    this.signal?.throwIfAborted();
    const expiry = this.activeUntil();
    if (!this.key() || Number.isNaN(expiry) || expiry <= Date.now() || process.env.BOOKDATABASE_DISABLED === "true") {
      await this.store.purge();
      throw new CatalogError("CATALOG_NOT_CONFIGURED", 503);
    }
    return expiry;
  }

  async get(path: string, ttlMs = 6 * 3_600_000): Promise<any> {
    await this.assertActive();
    const url = providerURL(path);
    const cacheKey = url.href;
    const existing = this.inFlight.get(cacheKey);
    if (existing) { catalogLog("provider.coalesced", providerRequestFields(url), this.traceID); return existing; }
    const pending = this.load(url, Math.min(ttlMs, 86_400_000));
    this.inFlight.set(cacheKey, pending);
    try { return await pending; }
    catch (error) { catalogLog("provider.failed", { ...providerRequestFields(url), ...catalogFailure(error) }, this.traceID); throw error; }
    finally { this.inFlight.delete(cacheKey); }
  }

  private async load(url: URL, ttl: number): Promise<any> {
    const cacheKey = `validated-v2:${url.href}`;
    const cached = await this.store.get(cacheKey);
    if (cached !== undefined) { catalogLog("provider.cache_hit", providerRequestFields(url), this.traceID); return cached; }
    const owner = randomUUID();
    const deadline = Date.now() + 25_000;
    while (!(await this.store.claim(cacheKey, owner))) {
      this.signal?.throwIfAborted();
      if (Date.now() > deadline) throw new CatalogError("PROVIDER_BUSY", 429, 15);
      await delay(150, this.signal);
      const shared = await this.store.get(cacheKey);
      if (shared !== undefined) return shared;
    }
    try {
      const shared = await this.store.get(cacheKey);
      if (shared !== undefined) return shared;
      const expiry = await this.assertActive();
      if (this.quota.blockedUntil > Date.now()) throw new CatalogError("PROVIDER_QUOTA_EXHAUSTED", 429, Math.ceil((this.quota.blockedUntil - Date.now()) / 1000));
      let response: Response | undefined;
      const attempts = this.requestTimeoutMs < 15_000 ? 1 : 2;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const waiting = Date.now();
        await this.store.reserve(this.signal);
        this.signal?.throwIfAborted();
        const started = Date.now();
        catalogLog("provider.request", { ...providerRequestFields(url), attempt: attempt + 1, quotaWaitMs: started - waiting }, this.traceID);
        try {
          const timeout = AbortSignal.timeout(this.requestTimeoutMs);
          const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
          response = await this.transport(url, { headers: { "X-API-Key": this.key(), Accept: "application/json" }, redirect: "manual", signal });
          catalogLog("provider.response", { ...providerRequestFields(url), status: response.status, elapsedMs: Date.now() - started }, this.traceID);
          if (response.status < 500 || attempt === attempts - 1) break;
          await response.arrayBuffer();
        } catch (error) {
          catalogLog("provider.transport_failed", { ...providerRequestFields(url), ...catalogFailure(error), elapsedMs: Date.now() - started, attempt: attempt + 1 }, this.traceID);
          this.signal?.throwIfAborted();
          const code = (error as { code?: string; cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code ?? "";
          if (/CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) throw new CatalogError("PROVIDER_TLS_FAILED", 503);
          if (attempt === attempts - 1) throw new CatalogError("PROVIDER_UNAVAILABLE", 503);
        }
      }
      if (!response) throw new CatalogError("PROVIDER_UNAVAILABLE", 503);
      if (response.status === 404) {
        await this.store.set(cacheKey, null, new Date(Math.min(Date.now() + 900_000, expiry)));
        return null;
      }
      const value: any = response.status === 302 ? { contentUrl: safeImageURL(response.headers.get("Location")) } : await response.json().catch(() => null);
      this.signal?.throwIfAborted();
      if (!response.ok && response.status !== 302) {
        catalogLog("provider.rejected", { ...providerRequestFields(url), status: response.status, code: value?.errorCode ?? "HTTP_ERROR", problematicParameter: value?.problematicParameter ?? null }, this.traceID);
        if (response.status === 401 || response.status === 403 || ["INVALID_API_KEY", "MISSING_API_KEY"].includes(value?.errorCode)) {
          await this.store.purge();
          throw new CatalogError("PROVIDER_ACCESS_DENIED", 503);
        }
        if (value?.errorCode === "NO_API_CALLS_REMAINING" || response.status === 429) {
          const midnight = new Date(); midnight.setUTCHours(24, 0, 0, 0);
          this.quota.blockedUntil = value?.errorCode === "NO_API_CALLS_REMAINING" ? midnight.getTime() : Date.now() + 60_000;
          throw new CatalogError("PROVIDER_QUOTA_EXHAUSTED", 429, Math.ceil((this.quota.blockedUntil - Date.now()) / 1000));
        }
        if (value?.errorCode === "INVALID_FORMAT_CONTINUATION_TOKEN") throw new CatalogError("PROVIDER_PAGINATION_INVALID", 502);
        throw new CatalogError("PROVIDER_UNAVAILABLE", 503);
      }
      if (!value || typeof value !== "object") throw new CatalogError("INVALID_PROVIDER_RESPONSE", 502);
      if (response.status === 302 && !value.contentUrl) throw new CatalogError("INVALID_IMAGE_URL", 502);
      if (response.status !== 302) validateProviderPayload(value, url);
      const effectiveTTL = response.status === 302 ? Math.min(ttl, 240_000) : ttl;
      await this.store.set(cacheKey, value, new Date(Math.min(Date.now() + effectiveTTL, expiry)));
      return value;
    } finally { await this.store.release(cacheKey, owner); }
  }

  async *pages(collection: string, query: Record<string, string>, maxPages = 1): AsyncGenerator<Resource[]> {
    const url = new URL(collection, BASE);
    Object.entries({ pageSize: "30", ...query }).forEach(([key, value]) => url.searchParams.set(key, value));
    let next: string | undefined = url.href;
    const seen = new Set<string>();
    const items = new Set<string>();
    let expandedPage = false;
    const limit = collection === "languages" ? Math.min(maxPages, 80) : Math.min(maxPages, 3);
    for (let i = 0; i < limit && next && !seen.has(next); i++) {
      seen.add(next);
      let value: unknown;
      try { value = await this.get(next); }
      catch (error) {
        if (!(error instanceof CatalogError) || error.code !== "PROVIDER_PAGINATION_INVALID" || expandedPage || collection === "languages") throw error;
        expandedPage = true;
        const expanded = new URL(url);
        expanded.searchParams.set("pageSize", String(Math.min(100, Number(url.searchParams.get("pageSize")) * limit)));
        catalogLog("provider.pagination_fallback", { collection, pageSize: expanded.searchParams.get("pageSize"), reason: "provider_rejected_own_continuation_token" }, this.traceID);
        // Keep the same documented filters; do not fabricate a continuation token.
        value = await this.withTimeout(Math.max(12_000, this.requestTimeoutMs)).get(expanded.href);
        next = undefined;
      }
      const page = parsePage(value, collection);
      catalogLog("provider.page", { collection, page: i + 1, records: page.items.length, hasNext: !!page.next }, this.traceID);
      const fresh = page.items.filter(item => {
        if (items.has(item.id)) return false;
        items.add(item.id);
        return true;
      });
      yield fresh;
      next = expandedPage ? undefined : page.next;
    }
  }

  async page(collection: string, query: Record<string, string>, maxPages = 1): Promise<Resource[]> {
    const items: Resource[] = [];
    for await (const page of this.pages(collection, query, maxPages)) items.push(...page);
    return items;
  }
}
