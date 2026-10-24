import { randomUUID } from "node:crypto";
import { catalogLog } from "../catalogDiagnostics";
import { allocateSections, RecommendationCatalogCache } from "./catalogCache";
import { catalogBook, cleanText, hash, libraryIdentity, mergeBooks, mergeCandidates, ownedMatches, sameBook, text, title } from "./normalization";
import { BookDatabaseSupplement } from "./providers/bookDatabase";
import { RecommendationStore } from "./repository";
import { buildProfile, discoveryPlans, finishedBooks, profileKey, rankCategories, recommendationScore, relevance, selectSeeds } from "./strategies";
import { hasPreferenceInputs } from "./readingPreferences";
import { Book, BookKnowledgeSource, CatalogResponse, CategoryID, categoryIDs, DiscoveryProvider, ENGINE_VERSION, JobResponse, LibraryBook, ProviderContext, ReadingPreferences, RecommendationError } from "./types";

type Job = { state: "building" | "ready" | "failed"; traceID: string; deadline: number; targets: CategoryID[]; errorCode?: string };
export class LoomeyRecommendationEngine {
  readonly cache: RecommendationCatalogCache;
  private running = new Map<string, Promise<CatalogResponse>>();
  constructor(private store: RecommendationStore, private providers: DiscoveryProvider[], readonly supplement?: BookDatabaseSupplement, private timeoutMs = 180000, private knowledge?: BookKnowledgeSource) {
    this.cache = new RecommendationCatalogCache(store);
  }
  private ownership(library: LibraryBook[]) { return hash(JSON.stringify(library.map(book => libraryIdentity(book)).sort((a, b) => a.title.localeCompare(b.title)))); }
  private async cached(library: LibraryBook[], preferences?: ReadingPreferences) { return this.cache.read(profileKey(library, preferences), library, await this.supplement?.available() ?? false); }

  async requestCatalogs(library: LibraryBook[], forceRefresh = false, traceID = randomUUID(), requested: string[] = categoryIDs, preferences?: ReadingPreferences): Promise<JobResponse> {
    const cached = await this.cached(library, preferences);
    if (!finishedBooks(library).length && !hasPreferenceInputs(preferences)) return { ...cached.response, catalogs: [], state: "ready", partial: false, traceID };
    const ownership = this.ownership(library);
    const targets = (requested as CategoryID[]).filter(id => categoryIDs.includes(id) && (forceRefresh || !cached.records.has(id) || Date.parse(cached.records.get(id)!.refreshAfter) <= Date.now()
      || (cached.records.get(id)!.ownership !== ownership && cached.records.get(id)!.ids.length >= 2 && (cached.pools.get(id)?.length ?? 0) < 2)));
    const key = `${ENGINE_VERSION}:job:${profileKey(library, preferences)}:${ownership}`;
    const previous = await this.store.get<Job>(key);
    if (previous?.state === "building" && previous.deadline > Date.now()) {
      // Claiming the short lease recovers work interrupted by a server restart, without running two jobs.
      if (!this.running.has(key)) {
        const recovery = randomUUID();
        if (await this.store.claim(key, recovery, 45000)) {
          await this.store.release(key, recovery);
          this.dispatch(key, library, previous.targets ?? targets, previous.traceID, preferences);
        }
      }
      return { ...cached.response, state: "building", partial: true, retryAfter: 4, traceID: previous.traceID };
    }
    if (!targets.length) {
      const failed = !cached.response.catalogs.length && Object.values(cached.response.categoryStates).some(state => state.state === "error");
      return { ...cached.response, state: failed ? "failed" : "ready", ...(failed ? { errorCode: "PROVIDER_UNAVAILABLE" } : {}), traceID };
    }
    this.dispatch(key, library, targets, traceID, preferences);
    return { ...cached.response, state: "building", partial: true, retryAfter: 4, traceID };
  }

  private dispatch(key: string, library: LibraryBook[], targets: CategoryID[], traceID: string, preferences?: ReadingPreferences) {
    if (this.running.has(key)) return;
    const owner = randomUUID();
    const work = (async () => {
      if (!await this.store.claim(key, owner, 45000)) return (await this.cached(library, preferences)).response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new RecommendationError("CATALOG_TIMED_OUT", 504)), this.timeoutMs);
      const heartbeat = setInterval(() => {
        void this.store.claim(key, owner, 45000).then(owned => { if (!owned) controller.abort(new RecommendationError("CATALOG_JOB_SUPERSEDED")); })
          .catch(() => controller.abort(new RecommendationError("CATALOG_STORE_UNAVAILABLE")));
      }, 15000);
      heartbeat.unref();
      try {
        await this.store.set(key, { state: "building", traceID, deadline: Date.now() + this.timeoutMs, targets } satisfies Job, this.timeoutMs + 60000);
        const response = await this.generate(library, targets, { signal: controller.signal, traceID, budgets: { hardcover: 24, "google-books": 24, "open-library": 22 }, failures: new Set() }, preferences);
        await this.store.set(key, { state: "ready", traceID, deadline: 0, targets } satisfies Job, 300000);
        return response;
      } catch (error: any) {
        catalogLog("engine.job_failed", { code: error?.code ?? "CATALOG_UNAVAILABLE", categories: targets }, traceID);
        for (const id of targets) await this.cache.write(profileKey(library, preferences), id, [], this.ownership(library), true, true);
        await this.store.set(key, { state: "failed", traceID, deadline: 0, targets, errorCode: error?.code ?? "CATALOG_UNAVAILABLE" } satisfies Job, 300000);
        return (await this.cached(library, preferences)).response;
      } finally { clearTimeout(timer); clearInterval(heartbeat); await this.store.release(key, owner); }
    })();
    this.running.set(key, work);
    void work.catch(error => catalogLog("engine.job_storage_failed", { code: error?.code ?? "CATALOG_STORE_UNAVAILABLE" }, traceID)).finally(() => this.running.delete(key));
  }

  // Awaitable entry point for server callers and deterministic, fully mocked tests.
  async catalogs(library: LibraryBook[], _publish?: (response: CatalogResponse) => Promise<void>, forceRefresh = false, traceID = randomUUID(), requested: string[] = categoryIDs, preferences?: ReadingPreferences): Promise<CatalogResponse> {
    const initial = await this.requestCatalogs(library, forceRefresh, traceID, requested, preferences);
    const key = `${ENGINE_VERSION}:job:${profileKey(library, preferences)}:${this.ownership(library)}`;
    const running = this.running.get(key);
    return running ? running : initial;
  }

  private async generate(library: LibraryBook[], targets: CategoryID[], context: ProviderContext, preferences?: ReadingPreferences): Promise<CatalogResponse> {
    const selected = selectSeeds(library);
    const active = this.providers.filter(provider => provider.available());
    catalogLog("engine.started", { engine: ENGINE_VERSION, finishedBooks: finishedBooks(library).length, excludedBooks: library.length, selectedSeeds: selected.length, providers: active.map(provider => provider.name), categories: targets,
      preferenceStyle: preferences?.recommendationStyle ?? "history_only", favoriteGenres: preferences ? preferences.favoriteFictionGenres.length + preferences.favoriteNonfictionGenres.length : 0, currentInterests: preferences?.currentlyInterestedIn.length ?? 0 }, context.traceID);
    const resolved: Book[] = [];
    const failed = new Set<CategoryID>();
    const isolated = async <T>(provider: DiscoveryProvider, operation: string, categories: CategoryID[], work: () => Promise<T>, fallback: T): Promise<T> => {
      try { context.signal.throwIfAborted(); return await work(); }
      catch (error: any) {
        categories.forEach(id => failed.add(id));
        context.failures?.add(provider.name);
        catalogLog("engine.source_failed", { provider: provider.name, operation, categories, code: error?.code ?? "PROVIDER_UNAVAILABLE" }, context.traceID);
        return fallback;
      }
    };
    const knowledge = this.knowledge?.available() ? this.knowledge : undefined;
    if (knowledge) {
      try { resolved.push(...await knowledge.resolve(selected, context)); }
      catch (error: any) { catalogLog("engine.knowledge_failed", { stage: "finished_lookup", code: error?.code ?? "KNOWLEDGE_UNAVAILABLE" }, context.traceID); }
    }
    let profile = buildProfile(library, mergeCandidates(resolved), preferences);
    const candidates: Book[] = [];
    const ownership = this.ownership(library);
    let updates: Promise<void> = Promise.resolve();
    const publish = async (final = false) => {
      updates = updates.then(async () => {
        const merged = mergeCandidates(candidates);
        const ranked = rankCategories(merged, profile, library, targets);
        for (const id of targets) {
          const books = ranked.get(id) ?? [];
          const incomplete = failed.has(id) || context.signal.aborted;
          await this.cache.write(profile.signature, id, books, ownership, incomplete, final);
        }
      });
      await updates;
    };
    let fallbackTargets = targets;
    if (knowledge) {
      let consecutiveFailures = 0;
      for (const plan of discoveryPlans(profile, targets, "hardcover")) {
        if (context.signal.aborted || candidates.length >= 192) break;
        try {
          const books = await knowledge.discover(plan, context, preferences);
          consecutiveFailures = 0;
          for (const book of books) {
            if (library.some(owned => ownedMatches(owned, book)) || profile.seeds.some(seed => sameBook(seed, book))
              || !targets.some(id => recommendationScore(id, book, profile) !== null)) continue;
            const existing = candidates.find(candidate => sameBook(candidate, book));
            const merged = existing ? mergeBooks(existing, book) : book;
            if (existing) candidates.splice(candidates.indexOf(existing), 1);
            if (existing || candidates.length < 192) { candidates.push(merged); await this.cache.saveBook(merged); }
          }
          await publish();
        } catch (error: any) {
          catalogLog("engine.knowledge_failed", { stage: plan.kind, code: error?.code ?? "KNOWLEDGE_UNAVAILABLE" }, context.traceID);
          if (++consecutiveFailures >= 2) break;
        }
      }
      const localSections = allocateSections(rankCategories(mergeCandidates(candidates), profile, library, targets));
      fallbackTargets = targets.filter(id => {
        if (id === "authors-read" && !profile.authors.size || id === "related" && !profile.seeds.length
          || id === "genres" && !profile.genres.size || id === "themes" && !profile.themes.size) return false;
        // Four older matches do not constitute sufficient coverage for discovery.
        const section = localSections.get(id) ?? [];
        const recent = section.filter(book => book.releaseYear !== null && book.releaseYear >= new Date().getUTCFullYear() - 5);
        return section.length < 8 || recent.length < 4;
      });
      catalogLog("engine.knowledge_coverage", { candidates: candidates.length, fallbackCategories: fallbackTargets }, context.traceID);
      if (!fallbackTargets.length) {
        await publish(true);
        return { ...(await this.cached(library, preferences)).response, traceID: context.traceID };
      }
    }
    const missingSeeds = selected.filter(seed => !resolved.some(book => sameBook(libraryIdentity(seed), book)));
    await Promise.all(active.map(async provider => {
      if (knowledge && !missingSeeds.length) return;
      const lookupContext = { ...context, signal: AbortSignal.any([context.signal, AbortSignal.timeout(35000)]) };
      const books = await isolated(provider, "finished_lookup", [], () => provider.resolve(knowledge ? missingSeeds : selected, lookupContext), []);
      resolved.push(...books.filter(book => selected.some(seed => sameBook(libraryIdentity(seed), book))));
    }));
    profile = buildProfile(library, mergeCandidates(resolved), preferences);
    await Promise.all(active.map(async provider => {
      let consecutiveFailures = 0;
      let accepted = 0;
      const plans = discoveryPlans(profile, fallbackTargets, provider.name);
      for (const plan of plans) {
        if (context.signal.aborted) break;
        const books = await isolated(provider, plan.kind, plan.categories, () => provider.discover(plan, context), null);
        if (books === null) {
          if (++consecutiveFailures >= 2) {
            for (const remaining of plans.slice(plans.indexOf(plan) + 1)) remaining.categories.forEach(id => failed.add(id));
            break;
          }
          continue;
        }
        consecutiveFailures = 0;
        const relevant = books.filter(book => !library.some(owned => ownedMatches(owned, book)) && !profile.seeds.some(seed => sameBook(seed, book))
          && targets.some(id => recommendationScore(id, book, profile) !== null));
        for (const book of relevant) {
          const existing = candidates.find(candidate => sameBook(candidate, book));
          const merged = existing ? mergeBooks(existing, book) : book;
          if (existing) candidates.splice(candidates.indexOf(existing), 1);
          if (existing || accepted < 64) { candidates.push(merged); await this.cache.saveBook(merged); if (!existing) accepted++; }
        }
        catalogLog("engine.discovery", { provider: provider.name, strategy: plan.kind, returned: books.length, accepted: relevant.length, candidates: candidates.length }, context.traceID);
        await publish();
      }
    }));
    // Enrich the strongest incomplete candidates, not every search result.
    const enrichmentScore = (book: Book) => preferences ? Math.max(0, ...targets.map(id => recommendationScore(id, book, profile) ?? 0)) : relevance(book, profile).total;
    const strongest = mergeCandidates(candidates).sort((a, b) => enrichmentScore(b) - enrichmentScore(a) || a.id.localeCompare(b.id));
    let supplementalCalls = 0;
    for (const candidate of strongest.filter(book => !book.coverUrls.length || book.coverQuality === "thumbnail" || !book.description || !book.isbns.length).slice(0, 12)) {
      if (context.signal.aborted) break;
      let enriched = candidate;
      for (const name of ["hardcover", "google-books", "open-library"] as const) {
        if (enriched.coverUrls.length && enriched.coverQuality !== "thumbnail" && enriched.description && enriched.isbns.length) break;
        const provider = active.find(provider => provider.name === name);
        if (!provider) continue;
        const metadata = await isolated(provider, "metadata", [], () => provider.enrich(enriched, context), null);
        if (metadata && sameBook(enriched, metadata)) enriched = mergeBooks(enriched, metadata);
      }
      await this.cache.saveBook(enriched);
      if ((!enriched.coverUrls.length || !enriched.description) && this.supplement && supplementalCalls < 3 && !context.signal.aborted) {
        supplementalCalls++;
        try {
          const metadata = await this.supplement.enrich(enriched, context);
          if (metadata) enriched = mergeBooks(enriched, metadata);
        } catch (error: any) { catalogLog("engine.supplement_failed", { code: error?.code ?? "PROVIDER_UNAVAILABLE" }, context.traceID); }
      }
      const index = candidates.findIndex(book => sameBook(book, candidate));
      if (index >= 0) candidates[index] = enriched;
    }
    await publish(true);
    const response = (await this.cached(library, preferences)).response;
    catalogLog("engine.completed", { candidates: candidates.length, sections: response.catalogs.map(row => ({ id: row.id, books: row.books.length })), failedProviders: [...context.failures ?? []], partial: response.partial }, context.traceID);
    return { ...response, traceID: context.traceID };
  }

  async work(id: string): Promise<ReturnType<typeof catalogBook> | null> {
    const book = await this.cache.book(id, await this.supplement?.available() ?? false);
    return book ? catalogBook(book) : null;
  }
  async libraryMetadata(id: string, identity?: { title?: unknown; author?: unknown; isbn?: unknown }) {
    let book = await this.cache.book(id, false);
    if (!book && text(identity?.title) && text(identity?.author)) {
      const lookup: LibraryBook = { id, title: title(identity!.title).slice(0, 2048), author: cleanText(identity!.author).slice(0, 512), isbn: text(identity!.isbn).slice(0, 64),
        genres: [], subjects: [], status: "Lookup", rating: 0, favorite: false, activity: 0 };
      const context: ProviderContext = { traceID: randomUUID(), signal: AbortSignal.timeout(25000), budgets: { hardcover: 6, "google-books": 3, "open-library": 3 } };
      // Compatibility for a previously saved catalog card: identify metadata, never use it as a reading signal.
      const local = this.knowledge?.available() ? await this.knowledge.resolve([lookup], context).catch(() => []) : [];
      const resolved = local.length ? [local] : await Promise.all(this.providers.filter(provider => provider.available()).map(async provider => {
        try { return (await provider.resolve([lookup], context)).filter(candidate => sameBook(libraryIdentity(lookup), candidate)); }
        catch (error: any) { catalogLog("engine.library_lookup_failed", { provider: provider.name, code: error?.code ?? "PROVIDER_UNAVAILABLE" }, context.traceID); return []; }
      }));
      book = mergeCandidates(resolved.flat())[0] ?? null;
      if (book) { await this.cache.saveBook(book); await this.store.set(`book:${id}`, book, 7 * 86400000); }
    }
    if (!book) throw new RecommendationError("BOOK_NOT_FOUND", 404);
    const value = catalogBook(book);
    return { title: value.title, author: value.author, subtitle: value.subtitle, publisher: value.publisher, publicationYear: value.releaseYear, isbn: value.isbn,
      summary: value.summary, coverUrl: value.coverUrl, pages: value.pages, rating: null, genres: value.genres, themes: value.subjects,
      subgenres: [], moods: [], tags: [], tropes: [], tone: null, pacing: null, audience: null, romanceLevel: null, darknessLevel: null, source: value.source };
  }
}
