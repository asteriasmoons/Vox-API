import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
const require = createRequire(import.meta.url);
require("ts-node/register/transpile-only");
const root = "../src/services/loomeyRecommendations/";
const { emptyBook, isbn, isbnVariants, title, authorKeys, sameBook, mergeBooks, mergeCandidates, libraryIdentity, parseLibrary, catalogBook } = require(root + "normalization.ts");
const { buildProfile, selectSeeds, profileKey, discoveryPlans, relevance, categoryScore, rankCategories } = require(root + "strategies.ts");
const { RecommendationCatalogCache, allocateSections, RETENTION } = require(root + "catalogCache.ts");
const { LoomeyRecommendationEngine } = require(root + "engine.ts");
const { HardcoverProvider, hardcoverBook, HARDCOVER_BOOKS_QUERY } = require(root + "providers/hardcover.ts");
const { GoogleBooksProvider, googleBook } = require(root + "providers/googleBooks.ts");
const { OpenLibraryProvider, openLibraryBook } = require(root + "providers/openLibrary.ts");
const { BookDatabaseSupplement } = require(root + "providers/bookDatabase.ts");
const { ProviderTransport } = require(root + "transport.ts");
const { categoryIDs, RecommendationError } = require(root + "types.ts");
const { MongoRecommendationStore } = require(root + "repository.ts");

class MemoryStore {
  rows = new Map(); locks = new Map(); reservations = [];
  async get(key) { const row = this.rows.get(key); return row && row.expires > Date.now() ? structuredClone(row.value) : undefined; }
  async set(key, value, ttl) { this.rows.set(key, { value: structuredClone(value), expires: Date.now() + ttl }); }
  async remove(key) { this.rows.delete(key); }
  async purgeGroup(group) { for (const key of this.rows.keys()) if (key.startsWith(group + ":")) this.rows.delete(key); }
  async claim(key, owner, ttl) { const previous = this.locks.get(key); if (previous && previous.owner !== owner && previous.expires > Date.now()) return false; this.locks.set(key, { owner, expires: Date.now() + ttl }); return true; }
  async release(key, owner) { if (this.locks.get(key)?.owner === owner) this.locks.delete(key); }
  async reserve(provider, interval, dailyLimit, signal) { signal.throwIfAborted(); this.reservations.push({ provider, interval, dailyLimit }); }
}
const context = () => ({ signal: new AbortController().signal, traceID: "unit-test", budgets: { hardcover: 100, "google-books": 100, "open-library": 100 }, failures: new Set() });
const seed = (id = "finished", status = "Finished", changes = {}) => ({ id, title: "Completed Novel", author: "Known Author", isbn: "9780140328721", genres: ["Fantasy"], subjects: ["Dragons", "Political intrigue"], rating: 4, favorite: false, activity: 0, status, ...changes });
const book = (id, changes = {}) => ({ ...emptyBook("google-books", id), title: `Novel ${id}`, authors: [`Writer ${id}`], description: "Verified provider description", isbns: [], genres: ["Fantasy"], subjects: ["Dragons", "Political intrigue"], language: "eng", coverUrls: [`https://covers.example.test/${id}.jpg`], ...changes });
function fixtureProvider(name, candidates, failure = false) {
  return { name, calls: [], available: () => true,
    async resolve(sources) { this.calls.push(["resolve", sources]); if (failure) throw new RecommendationError("PROVIDER_TLS_FAILED"); return []; },
    async discover(plan) { this.calls.push(["discover", plan]); if (failure) throw new RecommendationError("PROVIDER_TIMED_OUT"); return candidates; },
    async enrich() { this.calls.push(["enrich"]); if (failure) throw new RecommendationError("PROVIDER_UNAVAILABLE"); return null; } };
}
const response = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

test("new engine has no dependency on retired recommendation logic, matching, or orchestration", () => {
  const files = readdirSync(new URL("../src/services/loomeyRecommendations/", import.meta.url)).filter(name => name.endsWith(".ts"));
  for (const file of files) {
    const source = readFileSync(new URL(`../src/services/loomeyRecommendations/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*(?:automaticCatalogService|automaticCatalogCache|catalogBookIdentity|bookCatalogService|regularRecs)/);
  }
  const route = readFileSync(new URL("../src/routes/automaticCatalogs.ts", import.meta.url), "utf8");
  const maintenance = readFileSync(new URL("../src/services/automaticCatalogMaintenance.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route + maintenance, /from ["'][^"']*automaticCatalogService/);
  assert.match(route, /service: loomeyRecommendationEngine/);
});

test("only Finished records shape the profile and provider seed selection", () => {
  const library = [seed(), seed("reading", "Reading", { author: "Reading Writer", genres: ["Horror"], subjects: ["Ghosts"] }), seed("tbr", "TBR"), seed("archived", "Archived")];
  const profile = buildProfile(library, []);
  assert.equal(profile.seeds.length, 1);
  assert.equal(selectSeeds(library).length, 1);
  assert.equal(profile.genres.has("horror"), false);
  assert.equal(profile.authors.has("reading writer"), false);
  assert.equal(profile.themes.has("ghosts"), false);
});

test("non-Finished preferences and reading activity cannot invalidate or influence personalization", () => {
  const a = parseLibrary({ books: [seed(), seed("other", "Reading")] });
  const b = parseLibrary({ books: [seed(), seed("other", "TBR", { rating: 5, favorite: true, activity: 900, genres: ["Horror"] })] });
  assert.equal(profileKey(a), profileKey(b));
  assert.deepEqual(b[1].genres, []);
  assert.equal(b[1].rating, 0);
});

test("Finished changes invalidate the profile; source selection is author-diverse and bounded", () => {
  assert.notEqual(profileKey([seed()]), profileKey([seed(), seed("next", "Finished", { title: "Next Novel" })]));
  const selected = selectSeeds(Array.from({ length: 40 }, (_, i) => seed(String(i), "Finished", { author: `Author ${i % 10}` })));
  assert.equal(selected.length, 8);
  assert.equal(new Set(selected.map(b => b.author)).size, 8);
});

test("ISBN-10/13 variants and alternate editions identify the same work", () => {
  assert.equal(isbn("ISBN-10: 0-14-032872-6"), "9780140328721");
  assert.deepEqual(isbnVariants("9780140328721"), ["9780140328721", "0140328726"]);
  assert.equal(isbn("9780140328722"), null);
  assert.ok(sameBook(book("one", { isbns: ["0140328726"], authors: ["Roald Dahl"] }), book("two", { isbns: ["9780140328721"], authors: ["Roald Dahl"] })));
});

test("formatting cleanup preserves meaningful subtitles and series installment information", () => {
  assert.equal(title("<b>River &amp; Stone</b> [Paperback]"), "River & Stone");
  assert.equal(title("Dune: A Novel (Kindle Edition)"), "Dune");
  assert.equal(title("River: The Lost Kingdom (Book 2)"), "River: The Lost Kingdom (Book 2)");
  assert.ok(authorKeys("Tolkien, J. R. R.").includes("jrr tolkien"));
});

test("same-title books by different authors and ISBN collisions with contradictory authors are not merged", () => {
  assert.equal(sameBook(book("one", { title: "Home", authors: ["Alice"] }), book("two", { title: "Home", authors: ["Bob"] })), false);
  assert.equal(sameBook(book("one", { isbns: ["9780140328721"], authors: ["Alice"] }), book("two", { isbns: ["9780140328721"], authors: ["Bob"] })), false);
});

test("provider namespaces cannot collide and bridge records merge multiple provider editions", () => {
  const a = book("gb_a", { title: "The Novel", authors: ["Alice"], providerIDs: { "google-books": ["12"] } });
  const b = book("hc_12", { title: "The Novel", authors: ["Alice"], providerIDs: { hardcover: ["12"] } });
  const c = book("ol_1", { title: "Different edition title", authors: ["Alice"], providerIDs: { "open-library": ["OL1W"] } });
  const bridge = book("bridge", { title: "The Novel", authors: ["Alice"], providerIDs: { hardcover: ["12"], "open-library": ["OL1W"] } });
  const merged = mergeCandidates([a, b, c, bridge]);
  assert.equal(merged.length, 1);
  assert.deepEqual(new Set(Object.keys(merged[0].providerIDs)), new Set(["hardcover", "google-books", "open-library"]));
});

test("merging preserves correct existing fields and unions only compatible identifiers and covers", () => {
  const a = book("a", { title: "Same", authors: ["Alice"], pages: 300, coverUrls: ["https://images.example.test/a.jpg"] });
  const b = book("b", { title: "Same", authors: ["Alice"], pages: null, publisher: "Publisher", coverUrls: ["https://images.example.test/b.jpg"] });
  const merged = mergeBooks(a, b);
  assert.equal(merged.pages, 300);
  assert.equal(merged.publisher, "Publisher");
  assert.equal(merged.coverUrls.length, 2);
});

test("every owned status is excluded, including alternate titles and editions", () => {
  const library = [seed(), ...["Reading", "TBR", "Archived"].map((status, i) => seed(String(i), status, { title: `Owned ${i}`, author: `Owned Writer ${i}`, isbn: "" }))];
  const candidates = library.slice(1).map((owned, i) => book(String(i), { title: `${owned.title} (Paperback)`, authors: [owned.author] }));
  candidates.push(book("fresh"));
  const ranked = rankCategories(candidates, buildProfile(library, []), library, ["similar"]);
  assert.deepEqual(ranked.get("similar").map(b => b.id), ["fresh"]);
});

test("a broad genre alone cannot qualify; category scores differ by actual evidence", () => {
  const profile = buildProfile([seed()], []);
  const unrelated = relevance(book("broad", { genres: ["Fiction"], subjects: [] }), profile);
  assert.ok(categoryIDs.every(id => categoryScore(id, unrelated) === null));
  const specific = relevance(book("fresh"), profile);
  assert.ok(categoryScore("themes", specific) > categoryScore("genres", specific));
  assert.equal(categoryScore("authors-read", specific), null);
  assert.equal(categoryScore("new-authors", relevance(book("known", { authors: ["Known Author"] }), profile)), null);
});

test("the same classification repeated as genre and subject is not double-counted", () => {
  const profile = buildProfile([seed("s", "Finished", { genres: ["Fantasy"], subjects: ["Fantasy"] })], []);
  const match = relevance(book("single", { genres: ["Fantasy"], subjects: ["Fantasy"] }), profile);
  assert.equal(match.genres, 1);
  assert.equal(match.themes, 0);
  assert.equal(categoryScore("similar", match), null);
});

test("flat provider categories cannot erase themes explicitly recorded on Finished books", () => {
  const providerBook = book("source", { title: "Completed Novel", authors: ["Known Author"], genres: ["Fantasy", "Dragons", "Political intrigue"] });
  const profile = buildProfile([seed()], [providerBook]);
  assert.ok(profile.genres.has("fantasy"));
  assert.ok(profile.themes.has("dragons"));
  assert.equal(profile.genres.has("dragons"), false);
});

test("series and documented related-work evidence qualify Related Books", () => {
  const source = book("hc_1", { title: "Completed Novel", authors: ["Known Author"], series: [{ id: "hc_9", name: "A Series", position: 1 }], relatedIDs: ["hc_2"] });
  const profile = buildProfile([seed()], [source]);
  assert.ok(categoryScore("related", relevance(book("hc_3", { series: [{ id: "hc_9", name: "A Series", position: 2 }] }), profile)) > 0);
  assert.ok(categoryScore("related", relevance(book("hc_2"), profile)) > 0);
});

test("category-specific plans use author, series, tags, themes and related work strategies", () => {
  const source = book("hc_1", { title: "Completed Novel", authors: ["Known Author"], authorIDs: ["hc_7"], tagIDs: ["3", "4"], series: [{ id: "hc_9", name: "A Series", position: 1 }], relatedIDs: ["hc_2"] });
  const profile = buildProfile([seed()], [source]);
  const plans = discoveryPlans(profile, categoryIDs, "hardcover");
  assert.ok(["author", "series", "interests", "related"].every(kind => plans.some(plan => plan.kind === kind)));
  assert.ok(discoveryPlans(profile, ["authors-read"], "google-books").every(plan => plan.kind === "author"));
  assert.ok(discoveryPlans(profile, ["themes"], "open-library").every(plan => plan.categories.length === 1 && plan.categories[0] === "themes"));
});

test("existing Finished series data drives supported Hardcover series queries without provider seed matching", async () => {
  const library = parseLibrary({ books: [seed("finished", "Finished", { seriesName: "Known Series", seriesNumber: "2" }), seed("reading", "Reading", { seriesName: "Forbidden Series", seriesNumber: "9" })] });
  const profile = buildProfile(library, []);
  const plans = discoveryPlans(profile, ["related"], "hardcover");
  assert.ok(plans.some(plan => plan.seriesName === "Known Series"));
  assert.ok(plans.every(plan => plan.seriesName !== "Forbidden Series"));
  let query;
  const provider = new HardcoverProvider(new ProviderTransport(new MemoryStore(), async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes("LoomeyLanguages")) return response({ data: { languages: [{ id: 8, code2: "en" }] } });
    query = request.variables.where;
    return response({ data: { books: [] } });
  }), () => "fixture");
  await provider.discover(plans.find(plan => plan.seriesName), context());
  assert.equal(query._and[0].book_series.series.name._eq, "Known Series");
  assert.equal(relevance(book("unrelated-series", { series: [{ id: "hc_44", name: "Known Series", position: 3 }] }), profile).series, false);
});

test("ranked categories diversify authors and series and global allocation never repeats a book", () => {
  const profile = buildProfile([seed()], []);
  const candidates = Array.from({ length: 50 }, (_, i) => book(`b${i}`, { authors: [i < 6 ? "Known Author" : `Writer ${i}`] }));
  const pools = rankCategories(candidates, profile, [seed()], categoryIDs);
  const allocated = allocateSections(pools);
  assert.equal(allocated.size, 7);
  const all = [...allocated.values()].flat();
  assert.equal(new Set(all.map(b => b.id)).size, all.length);
  for (const [id, books] of pools) if (id !== "authors-read") assert.ok(books.filter(b => b.authors[0] === "Known Author").length <= 2);
});

test("genre diversification balances equally relevant interests without admitting unrelated filler", () => {
  const library = [seed(), seed("horror-source", "Finished", { title: "Other completed book", genres: ["Horror"] })];
  const candidates = [...Array.from({ length: 10 }, (_, i) => book(`fantasy${i}`)), ...Array.from({ length: 4 }, (_, i) => book(`horror${i}`, { genres: ["Horror"] }))];
  const ranked = rankCategories(candidates, buildProfile(library, []), library, ["genres"]).get("genres");
  assert.ok(ranked.slice(0, 4).some(book => book.genres.includes("Horror")));
  assert.ok(ranked.slice(0, 4).some(book => book.genres.includes("Fantasy")));
});

test("Google parses partial records, complete titles, identifiers and actual high-resolution links", () => {
  const raw = { id: "volume", volumeInfo: { title: "River", subtitle: "A Story", authors: ["Alice"], language: "en", industryIdentifiers: [{ type: "ISBN_10", identifier: "0140328726" }], imageLinks: { medium: "http://books.google.com/medium.jpg", thumbnail: "http://books.google.com/small.jpg" } } };
  const parsed = googleBook(raw);
  assert.equal(parsed.title, "River: A Story");
  assert.equal(parsed.isbns[0], "9780140328721");
  assert.equal(parsed.coverUrls[0], "https://books.google.com/medium.jpg");
  assert.equal(parsed.pages, null);
  assert.equal(googleBook({ id: "noauth", volumeInfo: { title: "Title", language: "en" } }), null);
  assert.equal(googleBook({ ...raw, volumeInfo: { ...raw.volumeInfo, language: "fr" } }), null);
});

test("Google discovery queries English author/subjects with bounded documented pagination", async () => {
  const urls = [];
  const transport = new ProviderTransport(new MemoryStore(), async (url) => { urls.push(new URL(url)); return response({ totalItems: 0 }); });
  const provider = new GoogleBooksProvider(transport, () => "test-key");
  await provider.discover({ key: "plan", kind: "interests", categories: ["themes"], terms: ["Fantasy", "Dragons"], tagIDs: [], workIDs: [] }, context());
  assert.equal(urls[0].searchParams.get("q"), 'subject:"Fantasy" subject:"Dragons"');
  assert.equal(urls[0].searchParams.get("langRestrict"), "en");
  assert.equal(urls[0].searchParams.get("key"), "test-key");
});

test("Open Library selects a verified English edition rather than a foreign work title/ISBN", () => {
  const parsed = openLibraryBook({ key: "/works/OL1W", title: "Titre Francais", author_name: ["Alice"], isbn: ["foreign-isbn"], cover_i: 99, subject: ["Dragons"], editions: { docs: [{ key: "/books/OL2M", title: "English Title", language: ["eng"], isbn: ["0140328726"] }] } });
  assert.equal(parsed.title, "English Title");
  assert.deepEqual(parsed.isbns, ["9780140328721"]);
  assert.equal(parsed.coverUrls[0], "https://covers.openlibrary.org/b/olid/OL2M-L.jpg?default=false");
  assert.ok(parsed.coverUrls.every(url => !url.includes("/99-")));
  assert.equal(openLibraryBook({ key: "/works/OL1W", title: "English-looking", author_name: ["Alice"], language: ["eng"] }), null);
});

test("Open Library uses language filtering, edition fields and identified rate policy", async () => {
  const store = new MemoryStore(); let request;
  const provider = new OpenLibraryProvider(new ProviderTransport(store, async (url, init) => { request = { url: new URL(url), headers: init.headers }; return response({ docs: [] }); }), () => "contact@example.test");
  await provider.search('author:"Alice"', context());
  assert.match(request.url.searchParams.get("q"), /AND language:eng/);
  assert.match(request.url.searchParams.get("fields"), /editions.language/);
  assert.match(request.headers["User-Agent"], /contact@example.test/);
  assert.equal(store.reservations[0].interval, 400);
});

test("Open Library detail failure preserves verified search metadata and its legitimate cover", async () => {
  const raw = { key: "/works/OL1W", title: "The Novel", author_name: ["Alice"], editions: { docs: [{ key: "/books/OL2M", title: "The Novel", language: ["eng"] }] } };
  const provider = new OpenLibraryProvider(new ProviderTransport(new MemoryStore(), async url => {
    if (new URL(url).pathname === "/search.json") return response({ docs: [raw] });
    throw Object.assign(Error("TLS fixture"), { cause: { code: "CERT_HAS_EXPIRED" } });
  }));
  const enriched = await provider.enrich(book("other", { title: "The Novel", authors: ["Alice"] }), context());
  assert.equal(enriched.title, "The Novel");
  assert.ok(enriched.coverUrls[0].includes("OL2M"));
});

test("catalog cards retain substantive subtitles without duplicating publisher annotations", () => {
  assert.equal(catalogBook(book("subtitle", { title: "River", subtitle: "The Lost Kingdom" })).title, "River: The Lost Kingdom");
  assert.equal(catalogBook(book("novel", { title: "River", subtitle: "A Novel" })).title, "River");
});

const hardcoverRaw = () => ({ id: 12, title: "Work Title", contributions: [{ contribution: "Author", author: { id: 9, name: "Alice" } }, { contribution: "Narrator", author: { id: 11, name: "Narrator" } }],
  cached_tags: { Genre: [{ tag: "Fantasy" }] }, taggings: [{ tag: { id: 33, tag: "Dragons" } }],
  book_series: [{ position: 2, series: { id: 4, name: "A Series" } }], cached_similar_book_ids: [13],
  editions: [{ id: 100, title: "English Title", isbn_13: "9780140328721", language_id: 8, image: { url: "https://images.hardcover.app/cover.jpg" } }] });
test("Hardcover maps actual schema relationships, canonical identities, English editions and authors", () => {
  const parsed = hardcoverBook(hardcoverRaw(), [8]);
  assert.deepEqual(parsed.authors, ["Alice"]);
  assert.equal(parsed.series[0].id, "hc_4");
  assert.deepEqual(parsed.relatedIDs, ["hc_13"]);
  assert.equal(parsed.tagIDs[0], "33");
  assert.equal(hardcoverBook(hardcoverRaw(), [7]), null);
});

test("Hardcover uses a backend bearer token and supported GraphQL filters without forbidden wildcard operators", async () => {
  const calls = [];
  const provider = new HardcoverProvider(new ProviderTransport(new MemoryStore(), async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer secret-fixture");
    const body = JSON.parse(init.body); calls.push(body);
    return response({ data: body.query.includes("LoomeyLanguages") ? { languages: [{ id: 8, code2: "en" }] } : { books: [hardcoverRaw()] } });
  }), () => "Bearer secret-fixture");
  const result = await provider.discover({ key: "author", kind: "author", categories: ["authors-read"], authorID: "hc_9", author: "Alice", terms: [], tagIDs: [], workIDs: [] }, context());
  assert.equal(result.length, 1);
  assert.equal(calls[1].variables.where._and[0].contributions.author_id._eq, 9);
  assert.doesNotMatch(HARDCOVER_BOOKS_QUERY, /_ilike|_regex|user_books|recommendations/);
});

test("Hardcover converts catalog tag identifiers to the schema's Int filter type", async () => {
  let where;
  const provider = new HardcoverProvider(new ProviderTransport(new MemoryStore(), async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.query.includes("LoomeyLanguages")) return response({ data: { languages: [{ id: 8, code2: "en" }] } });
    where = body.variables.where;
    return response({ data: { books: [] } });
  }), () => "fixture");
  await provider.discover({ key: "tags", kind: "interests", categories: ["themes"], terms: [], tagIDs: ["33", "34"], workIDs: [] }, context());
  assert.equal(where._and[0]._and[0].taggings.tag_id._eq, 33);
  assert.equal(where._and[0]._and[1].taggings.tag_id._eq, 34);
});

test("provider responses cache and concurrent identical requests coalesce", async () => {
  const store = new MemoryStore(); let calls = 0;
  const transport = new ProviderTransport(store, async () => { calls++; await new Promise(resolve => setTimeout(resolve, 2)); return response({ items: [] }); });
  const policy = { provider: "google-books", origin: "https://www.googleapis.com", intervalMs: 250, dailyLimit: 1000, timeoutMs: 100 };
  const url = new URL("https://www.googleapis.com/books/v1/volumes?q=test");
  await Promise.all([transport.json(policy, url, context()), transport.json(policy, url, context())]);
  await new ProviderTransport(store, async () => { throw Error("network must not run"); }).json(policy, url, context());
  assert.equal(calls, 1);
});

test("429 cooldown is shared and TLS failures never bypass certificates or endlessly retry", async () => {
  const store = new MemoryStore(); let calls = 0;
  const policy = { provider: "hardcover", origin: "https://api.hardcover.app", intervalMs: 1100, dailyLimit: 5000, timeoutMs: 100 };
  const url = new URL(policy.origin + "/v1/graphql");
  const limited = new ProviderTransport(store, async () => { calls++; return new Response("", { status: 429, headers: { "Retry-After": "30" } }); });
  await assert.rejects(limited.json(policy, url, context()), { code: "PROVIDER_RATE_LIMITED" });
  await assert.rejects(limited.json(policy, url, context()), { code: "PROVIDER_RATE_LIMITED" });
  assert.equal(calls, 1);
  const tls = new ProviderTransport(new MemoryStore(), async () => { throw Object.assign(new Error("TLS"), { cause: { code: "CERT_HAS_EXPIRED" } }); });
  await assert.rejects(tls.json(policy, url, context()), { code: "PROVIDER_TLS_FAILED" });
});

test("unsafe API redirects, malformed responses and bounded job budgets fail safely", async () => {
  const policy = { provider: "open-library", origin: "https://openlibrary.org", intervalMs: 1100, dailyLimit: 1500, timeoutMs: 100 };
  const url = new URL(policy.origin + "/search.json");
  const redirected = new ProviderTransport(new MemoryStore(), async () => new Response("", { status: 302, headers: { Location: "http://openlibrary.org/insecure" } }));
  await assert.rejects(redirected.json(policy, url, context()), { code: "UNSAFE_PROVIDER_REDIRECT" });
  const invalid = new ProviderTransport(new MemoryStore(), async () => new Response("<html>"));
  await assert.rejects(invalid.json(policy, url, context()), { code: "INVALID_PROVIDER_RESPONSE" });
  await assert.rejects(invalid.json(policy, url, { ...context(), budgets: { "open-library": 0 } }), { code: "PROVIDER_JOB_BUDGET_EXHAUSTED" });
});

test("persistent category cache survives engine recreation and does not fetch on a fresh read", async () => {
  const store = new MemoryStore();
  const candidates = Array.from({ length: 50 }, (_, i) => book(String(i), { authors: [i < 6 ? "Known Author" : `Writer ${i}`] }));
  const provider = fixtureProvider("google-books", candidates);
  const first = new LoomeyRecommendationEngine(store, [provider]);
  const result = await first.catalogs([seed()]);
  assert.equal(result.catalogs.length, 7);
  const calls = provider.calls.length;
  const second = new LoomeyRecommendationEngine(store, [provider]);
  const cached = await second.requestCatalogs([seed()]);
  assert.equal(cached.state, "ready");
  assert.equal(cached.catalogs.length, 7);
  assert.equal(provider.calls.length, calls);
  assert.ok(cached.catalogs.every(row => row.books.every(book => book.coverUrl && book.title && book.author)));
});

test("one failed provider does not prevent populated catalogs from the other two", async () => {
  const store = new MemoryStore();
  const a = fixtureProvider("hardcover", [], true);
  const b = fixtureProvider("google-books", Array.from({ length: 40 }, (_, i) => book(String(i))));
  const c = fixtureProvider("open-library", [book("more1", { authors: ["Known Author"] }), book("more2", { authors: ["Known Author"] })]);
  const result = await new LoomeyRecommendationEngine(store, [a, b, c]).catalogs([seed()]);
  assert.equal(result.catalogs.length, 7);
  assert.ok(b.calls.some(([operation]) => operation === "discover"));
  assert.ok(c.calls.some(([operation]) => operation === "discover"));
});

test("failed refresh retains category data and original expiration, while independent category refresh stays narrow", async () => {
  const store = new MemoryStore();
  const provider = fixtureProvider("google-books", Array.from({ length: 40 }, (_, i) => book(String(i))));
  const engine = new LoomeyRecommendationEngine(store, [provider]);
  const original = await engine.catalogs([seed()]);
  const signature = profileKey([seed()]);
  const genreKey = engine.cache.rowKey(signature, "genres");
  const originalGenres = await store.get(genreKey);
  const unrelated = await store.get(engine.cache.rowKey(signature, "themes"));
  const broken = new LoomeyRecommendationEngine(store, [fixtureProvider("google-books", [], true)]);
  const refreshed = await broken.catalogs([seed()], undefined, true, "test", ["genres"]);
  assert.ok(refreshed.catalogs.length > 0);
  assert.equal((await store.get(genreKey)).expiresAt, originalGenres.expiresAt);
  assert.deepEqual(await store.get(engine.cache.rowKey(signature, "themes")), unrelated);
  assert.ok(original.catalogs.length > 0);
});

test("progress and partially failed refreshes retain the rest of an existing category's usable pool", async () => {
  const store = new MemoryStore(); const cache = new RecommendationCatalogCache(store);
  const old = Array.from({ length: 6 }, (_, i) => book(`saved${i}`));
  const update = [book("new1"), book("new2")];
  for (const value of [...old, ...update]) await cache.saveBook(value);
  await cache.write("profile", "genres", old, "owned", false, true);
  await cache.write("profile", "genres", update, "owned", false, false);
  let row = await store.get(cache.rowKey("profile", "genres"));
  assert.equal(row.ids.length, 8);
  await cache.write("profile", "genres", update, "owned", true, true);
  row = await store.get(cache.rowKey("profile", "genres"));
  assert.equal(row.ids.length, 8);
  assert.equal(row.state, "stale");
});

test("new ownership is excluded immediately from saved pools without allowing Reading/TBR signals", async () => {
  const store = new MemoryStore();
  const provider = fixtureProvider("google-books", Array.from({ length: 40 }, (_, i) => book(String(i))));
  const engine = new LoomeyRecommendationEngine(store, [provider]);
  const generated = await engine.catalogs([seed()]);
  const owned = generated.catalogs[0].books[0];
  const response = await engine.requestCatalogs([seed(), seed("new-owned", "Reading", { title: owned.title, author: owned.author, isbn: "" })]);
  assert.ok(response.catalogs.flatMap(c => c.books).every(book => book.id !== owned.id));
});

test("cached recommendations are returned before a slow refresh and remain available if every source fails", async () => {
  const store = new MemoryStore();
  const provider = fixtureProvider("google-books", Array.from({ length: 40 }, (_, i) => book(String(i))));
  const engine = new LoomeyRecommendationEngine(store, [provider]);
  await engine.catalogs([seed()]);
  let release;
  const blocked = { ...fixtureProvider("google-books", []), resolve: async () => new Promise(resolve => { release = () => resolve([]); }) };
  const replacement = new LoomeyRecommendationEngine(store, [blocked]);
  const immediate = await replacement.requestCatalogs([seed()], true);
  assert.equal(immediate.state, "building");
  assert.ok(immediate.catalogs.length > 0);
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  release();
  await replacement.catalogs([seed()]);
});

test("licensed supplements expire/revoke independently of the saved multi-source catalog", async () => {
  const store = new MemoryStore(); const cache = new RecommendationCatalogCache(store);
  const base = book("base"); await cache.saveBook(base);
  await store.set("licensed:base", { ...base, sources: ["bookdatabase.io"], description: "Temporary", imageID: "image", metadataExpiresAt: new Date(Date.now() + 60000).toISOString() }, 60000);
  assert.ok((await cache.book("base", true)).sources.includes("bookdatabase.io"));
  const supplement = new BookDatabaseSupplement({}, store, () => false);
  await supplement.revoke();
  assert.equal(await store.get("licensed:base"), undefined);
  assert.ok(await cache.book("base", false));
  assert.equal((await cache.book("base", false)).description, base.description);
});

test("detail and Add to Library output use the saved normalized record without invoking retired enrichment", async () => {
  const store = new MemoryStore(); const engine = new LoomeyRecommendationEngine(store, []);
  await engine.cache.saveBook(book("gb_abc", { providerIDs: { "google-books": ["abc"] }, publisher: "Publisher" }));
  assert.equal((await engine.work("gb_abc")).source, "google-books");
  const detail = await engine.libraryMetadata("gb_abc");
  assert.equal(detail.publisher, "Publisher");
  assert.equal(detail.coverUrl, "https://covers.example.test/gb_abc.jpg");
  assert.equal(await engine.work("missing"), null);
});

test("legacy catalog cards resolve independent library-save metadata without becoming personalization signals", async () => {
  const provider = fixtureProvider("google-books", []);
  provider.resolve = async lookups => { assert.equal(lookups[0].status, "Lookup"); return [book("gb_new", { title: "Old Saved Recommendation", authors: ["Alice"] })]; };
  provider.discover = async () => assert.fail("library save must not generate recommendations");
  const engine = new LoomeyRecommendationEngine(new MemoryStore(), [provider]);
  const detail = await engine.libraryMetadata("legacy-work-id", { title: "Old Saved Recommendation", author: "Alice" });
  assert.equal(detail.title, "Old Saved Recommendation");
  assert.equal((await engine.work("legacy-work-id")).source, "google-books");
});

test("an ISBN-only owned record is excluded even when its stored title or author is missing", () => {
  const profile = buildProfile([seed()], []);
  const owned = seed("incomplete", "Archived", { title: "", author: "", isbn: "0140328726" });
  const candidate = book("edition", { isbns: ["9780140328721"] });
  assert.equal(rankCategories([candidate], profile, [seed(), owned], ["similar"]).get("similar").length, 0);
});

test("coauthored library strings resolve to individual verified authors, without confusing Science with Science Fiction", () => {
  const source = seed("coauthored", "Finished", { author: "Alice Doe, Bob Roe", genres: ["Science Fiction"], subjects: [] });
  const resolved = book("verified", { title: source.title, authors: ["Alice Doe", "Bob Roe"], genres: ["Science Fiction"], subjects: [] });
  const profile = buildProfile([source], [resolved]);
  assert.ok(profile.authors.has("alice doe"));
  assert.ok(profile.authors.has("bob roe"));
  assert.equal(relevance(book("nonfiction", { genres: ["Science"], subjects: [] }), profile).genres, 0);
});

test("metadata precedence is deterministic and actual full-size covers replace thumbnails without losing fallbacks", () => {
  const google = book("gb_g", { title: "The Novel", authors: ["Alice"], providerIDs: { "google-books": ["g"] }, coverQuality: "thumbnail" });
  const hardcover = book("hc_3", { title: "The Novel", authors: ["Alice"], providerIDs: { hardcover: ["3"] }, sources: ["hardcover"], coverUrls: ["https://images.hardcover.app/full.jpg"] });
  for (const merged of [mergeBooks(google, hardcover), mergeBooks(hardcover, google)]) {
    assert.equal(merged.id, "hc_3");
    assert.equal(merged.coverUrls[0], "https://images.hardcover.app/full.jpg");
    assert.equal(merged.coverUrls.length, 2);
    assert.deepEqual(merged.sources, ["hardcover", "google-books"]);
  }
});

for (const brokenName of ["google-books", "open-library"]) test(`${brokenName} failure leaves the other discovery providers usable`, async () => {
  const names = ["hardcover", "google-books", "open-library"];
  const candidates = Array.from({ length: 50 }, (_, i) => book(`resilient${i}`, { authors: [i < 5 ? "Known Author" : `Other Writer ${i}`] }));
  const providers = names.map(name => fixtureProvider(name, candidates, name === brokenName));
  const result = await new LoomeyRecommendationEngine(new MemoryStore(), providers).catalogs([seed()]);
  assert.equal(result.catalogs.length, 7);
});

test("Mongo budgets are shared across store instances and exhaustion/abort never need a live database", async () => {
  const rows = new Map();
  const control = {
    async updateOne(query, update) { if (!rows.has(query._id)) rows.set(query._id, structuredClone(update.$setOnInsert)); },
    async findOneAndUpdate(query, update) {
      const value = rows.get(query._id);
      if (!value || (query.nextAt && value.nextAt > query.nextAt.$lte) || (query.count && value.count >= query.count.$lt)) return null;
      const prior = structuredClone(value);
      if (update.$set) Object.assign(value, update.$set);
      if (update.$inc) value.count += update.$inc.count;
      return prior;
    },
  };
  const one = new MongoRecommendationStore({ Cache: {}, Control: control }, () => true);
  const two = new MongoRecommendationStore({ Cache: {}, Control: control }, () => true);
  await one.reserve("hardcover", 0, 2, context().signal);
  await two.reserve("hardcover", 0, 2, context().signal);
  await assert.rejects(one.reserve("hardcover", 0, 2, context().signal), { code: "PROVIDER_QUOTA_EXHAUSTED" });
  await one.reserve("open-library", 1000, 100, context().signal);
  const controller = new AbortController();
  const pending = two.reserve("open-library", 1000, 100, controller.signal);
  setTimeout(() => controller.abort(new Error("cancelled budget wait")), 5);
  await assert.rejects(pending, /cancelled budget wait/);
});

test("bookdatabase.io supplements verified English metadata in its own temporary cache, never the independent base", async () => {
  const store = new MemoryStore();
  const base = book("g", { title: "Completed Novel", authors: ["Known Author"], isbns: ["9780140328721"], description: "" });
  const edition = { id: "edition", title: base.title, isbns: base.isbns, description: "Supplemental description", _embedded: { authors: [{ id: "author", name: "Known Author" }], languages: [{ id: "lang" }], books: [{ id: "work" }], images: [{ id: "image" }] } };
  const client = { withSignal() { return this; }, withTimeout() { return this; }, assertActive: async () => Infinity,
    page: async () => [edition], get: async path => path.startsWith("languages/") ? { id: "lang", iso639Code: "eng" } : { id: "work", title: base.title, _embedded: { authors: [{ id: "author", name: "Known Author" }] } } };
  const cache = new RecommendationCatalogCache(store); await cache.saveBook(base);
  const supplement = new BookDatabaseSupplement(client, store, () => true);
  const enriched = await supplement.enrich(base, context());
  assert.equal(enriched.imageID, "image");
  assert.equal((await cache.book("g", true)).description, "Supplemental description");
  assert.equal((await cache.book("g", false)).description, "");
  assert.ok(Date.parse(enriched.metadataExpiresAt) <= Date.now() + 86400000);
  await supplement.revoke();
  assert.equal((await cache.book("g", true)).description, "");
});

test("all real provider adapters feed the new engine through mocked HTTP, saved rows, details and restart cache", async () => {
  const store = new MemoryStore();
  const hits = new Map();
  const google = (i, known = false) => ({ id: `volume${i}`, volumeInfo: { title: i === "seed" ? "Completed Novel" : `Google Novel ${i}`, authors: [known ? "Known Author" : `Google Writer ${i}`], language: "en", description: "Provider description", categories: ["Fantasy", "Dragons", "Political intrigue"], imageLinks: { medium: `https://books.google.com/cover${i}.jpg` }, ...(i === "seed" ? { industryIdentifiers: [{ type: "ISBN_13", identifier: "9780140328721" }] } : {}) } });
  const ol = (i, known = false) => ({ key: `/works/OL${i === "seed" ? 999 : i}W`, title: i === "seed" ? "Completed Novel" : `Library Novel ${i}`, author_name: [known ? "Known Author" : `Library Writer ${i}`], subject: ["Fantasy", "Dragons", "Political intrigue"], editions: { docs: [{ key: `/books/OL${i === "seed" ? 999 : i}M`, title: i === "seed" ? "Completed Novel" : `Library Novel ${i}`, language: ["eng"], ...(i === "seed" ? { isbn: ["9780140328721"] } : {}) }] } });
  const hc = (i, known = false) => ({ ...hardcoverRaw(), id: Number(i), title: i === 999 ? "Completed Novel" : `Hardcover Novel ${i}`, contributions: [{ contribution: "Author", author: { id: known ? 1 : 1000 + i, name: known ? "Known Author" : `Hardcover Writer ${i}` } }], book_series: [], cached_tags: { Genre: [{ tag: "Fantasy" }] }, taggings: [{ tag: { id: 33, tag: "Dragons" } }, { tag: { id: 34, tag: "Political intrigue" } }], editions: [{ id: i + 5000, title: i === 999 ? "Completed Novel" : `Hardcover Novel ${i}`, language_id: 8, image: { url: `https://images.hardcover.app/${i}.jpg` }, ...(i === 999 ? { isbn_13: "9780140328721" } : {}) }] });
  const transport = new ProviderTransport(store, async (input, init) => {
    const url = new URL(input); hits.set(url.host, (hits.get(url.host) ?? 0) + 1);
    if (url.host === "api.hardcover.app") {
      const body = JSON.parse(init.body);
      if (body.query.includes("LoomeyLanguages")) return response({ data: { languages: [{ id: 8, code2: "en" }] } });
      if (body.query.includes("LoomeySearch")) return response({ data: { search: { ids: [] } } });
      if (body.variables.where._or) return response({ data: { books: [hc(999, true)] } });
      return response({ data: { books: Array.from({ length: 18 }, (_, i) => hc(i + 1, i < 3)) } });
    }
    if (url.host === "www.googleapis.com") {
      const q = url.searchParams.get("q") ?? "";
      return response({ totalItems: 18, items: q.startsWith("isbn:") || q.startsWith("intitle:") ? [google("seed", true)] : Array.from({ length: 18 }, (_, i) => google(i, i < 3)) });
    }
    if (url.host === "openlibrary.org") {
      if (url.pathname.startsWith("/books/")) return response(null);
      const q = url.searchParams.get("q") ?? "";
      return response({ numFound: 18, docs: q.includes("isbn:") || q.includes("title:") ? [ol("seed", true)] : Array.from({ length: 18 }, (_, i) => ol(i + 1, i < 3)) });
    }
    throw Error("Unexpected live network path");
  });
  const providers = [new HardcoverProvider(transport, () => "fixture-token"), new GoogleBooksProvider(transport, () => "fixture-key"), new OpenLibraryProvider(transport, () => "test@example.test")];
  const engine = new LoomeyRecommendationEngine(store, providers);
  const generated = await engine.catalogs([seed()]);
  assert.equal(generated.catalogs.length, 7);
  const all = generated.catalogs.flatMap(row => row.books);
  assert.ok(all.every(book => book.language === "eng" && book.coverUrl && book.title && book.author));
  assert.equal(new Set(all.map(book => book.id)).size, all.length);
  for (const provider of ["hardcover", "google-books", "open-library"]) assert.ok(all.some(book => book.source.includes(provider)), `${provider} contributes selected recommendations`);
  assert.equal((await engine.libraryMetadata(all[0].id)).title, all[0].title);
  const requests = [...hits.values()].reduce((a, b) => a + b, 0);
  const restarted = new LoomeyRecommendationEngine(store, providers);
  assert.equal((await restarted.requestCatalogs([seed()])).catalogs.length, 7);
  assert.equal([...hits.values()].reduce((a, b) => a + b, 0), requests);
});
