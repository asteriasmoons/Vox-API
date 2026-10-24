import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { EventEmitter } from "node:events";
const require = createRequire(import.meta.url);
require("ts-node/register/transpile-only");
const root = "../src/services/loomeyRecommendations/";
const { emptyBook, isbn, isbnVariants, title, authorKeys, sameBook, mergeBooks, mergeCandidates, libraryIdentity, parseLibrary, catalogBook } = require(root + "normalization.ts");
const { buildProfile, selectSeeds, profileKey, discoveryPlans, relevance, categoryScore, recommendationScore, rankCategories } = require(root + "strategies.ts");
const { parseReadingPreferences, preferenceEvidence, hasPreferenceInputs } = require(root + "readingPreferences.ts");
const { RecommendationCatalogCache, allocateSections, RETENTION } = require(root + "catalogCache.ts");
const { LoomeyRecommendationEngine } = require(root + "engine.ts");
const { HardcoverProvider, hardcoverBook, HARDCOVER_BOOKS_QUERY } = require(root + "providers/hardcover.ts");
const { GoogleBooksProvider, googleBook } = require(root + "providers/googleBooks.ts");
const { OpenLibraryProvider, openLibraryBook } = require(root + "providers/openLibrary.ts");
const { BookDatabaseSupplement } = require(root + "providers/bookDatabase.ts");
const { ProviderTransport } = require(root + "transport.ts");
const { categoryIDs, RecommendationError } = require(root + "types.ts");
const { MongoRecommendationStore } = require(root + "repository.ts");
const { PostgresBookKnowledgeSource } = require(root + "knowledgeSource.ts");
const { knowledgeBook, queryKnowledgeBooks } = require("../src/bookKnowledge/queries.ts");
const { createAutomaticCatalogRouter } = require("../src/routes/automaticCatalogs.ts");

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
const book = (id, changes = {}) => ({ ...emptyBook("google-books", id), title: `Novel ${id}`, authors: [`Writer ${id}`], description: "Verified provider description", isbns: [], genres: ["Fantasy"], subjects: ["Dragons", "Political intrigue"], language: "eng", releaseYear: 2024, coverUrls: [`https://covers.example.test/${id}.jpg`], ...changes });
function fixtureProvider(name, candidates, failure = false) {
  return { name, calls: [], available: () => true,
    async resolve(sources) { this.calls.push(["resolve", sources]); if (failure) throw new RecommendationError("PROVIDER_TLS_FAILED"); return []; },
    async discover(plan) { this.calls.push(["discover", plan]); if (failure) throw new RecommendationError("PROVIDER_TIMED_OUT"); return candidates; },
    async enrich() { this.calls.push(["enrich"]); if (failure) throw new RecommendationError("PROVIDER_UNAVAILABLE"); return null; } };
}
const response = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const preferences = (changes = {}) => parseReadingPreferences({ preferences: { version: 1, preferredCategory: "both", favoriteFictionGenres: [], favoriteNonfictionGenres: [], currentlyInterestedIn: [], recommendationStyle: "blend_interests", ...changes } });

test("Google Books transient 503 retries with backoff and preserves the eventual success", async () => {
  let attempts = 0;
  const transport = new ProviderTransport(new MemoryStore(), async () => {
    attempts++;
    return attempts === 1
      ? new Response(JSON.stringify({ error: { errors: [{ reason: "backendFailed" }] } }), { status: 503 })
      : response({ totalItems: 1, items: [] });
  });
  const started = Date.now();
  const result = await new GoogleBooksProvider(transport).search("subject:fiction", context());
  assert.equal(result.total, 1);
  assert.equal(attempts, 2);
  assert.ok(Date.now() - started >= 1000, "retry must wait at least one second");
});

test("merged editions retain the earliest known publication year rather than a newer reprint", () => {
  const oldWork = book("ol-work", { title: "Reprinted Classic", authors: ["Author"], releaseYear: 1980 });
  const newEdition = book("google-edition", { title: "Reprinted Classic", authors: ["Author"], releaseYear: 2024 });
  assert.equal(mergeBooks(newEdition, oldWork).releaseYear, 1980);
  assert.equal(rankCategories([mergeBooks(newEdition, oldWork)], buildProfile([seed()], []), [seed()], ["similar"]).get("similar").length, 0);
});

test("2010 publication cutoff rejects unknown and old books but accepts contemporary releases", () => {
  const profile = buildProfile([seed()], []);
  const candidates = [book("old", { releaseYear: 1999 }), book("unknown", { releaseYear: null }), book("new", { releaseYear: 2024 })];
  assert.deepEqual(rankCategories(candidates, profile, [seed()], ["similar"]).get("similar").map(item => item.id), ["new"]);
});

test("unconfigured preferences preserve the original profile, cache namespace, scores and plans", () => {
  assert.equal(parseReadingPreferences({ books: [] }), undefined);
  assert.equal(hasPreferenceInputs(undefined), false);
  const profile = buildProfile([seed()], []);
  assert.equal(profile.signature, profileKey([seed()]));
  assert.ok(recommendationScore("similar", book("new"), profile) >= categoryScore("similar", relevance(book("new"), profile)), "recency boost must not reduce relevance");
  assert.deepEqual(discoveryPlans(profile, categoryIDs, "google-books"), discoveryPlans(buildProfile([seed()], [], undefined), categoryIDs, "google-books"));
});

test("preference payloads validate schema and text and normalize duplicates without inventing defaults", () => {
  for (const value of [false, [], {}, { version: 2 }, { ...preferences(), recommendationStyle: "unknown" }, { ...preferences(), currentlyInterestedIn: "dragons" }, { ...preferences(), currentlyInterestedIn: ["a".repeat(385)] }, { ...preferences(), favoriteFictionGenres: [4] }]) {
    assert.throws(() => parseReadingPreferences({ preferences: value }), error => error.code === "INVALID_READING_PREFERENCES" && error.status === 400);
  }
  const value = preferences({ favoriteFictionGenres: [" Fantasy ", "fantasy"], currentlyInterestedIn: ["Ancient history", "Ancient history"] });
  assert.deepEqual(value.favoriteFictionGenres, ["Fantasy"]);
  assert.deepEqual(value.currentlyInterestedIn, ["Ancient history"]);
});

test("all genre and interest selections are accepted and participate in profiles, ranking and cache keys", () => {
  const value = preferences({
    favoriteFictionGenres: Array.from({ length: 128 }, (_, index) => "Genre " + index),
    favoriteNonfictionGenres: Array.from({ length: 100 }, (_, index) => "Nonfiction Genre " + index),
    currentlyInterestedIn: Array.from({ length: 96 }, (_, index) => "Interest " + index),
    recommendationStyle: "follow_preferences",
  });
  assert.equal(value.favoriteFictionGenres.length, 128);
  assert.equal(value.favoriteNonfictionGenres.length, 100);
  assert.equal(value.currentlyInterestedIn.length, 96);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  const profile = buildProfile([], [], value);
  assert.ok(profile.genres.has("genre 127") && profile.genres.has("nonfiction genre 99"));
  assert.ok(profile.themes.has("interest 95"));
  const candidate = book("late-selection", { genres: ["Genre 127"], subjects: ["Interest 95"] });
  assert.equal(preferenceEvidence(candidate, value).favorites, 1);
  assert.equal(preferenceEvidence(candidate, value).current, 1);
  assert.ok(recommendationScore("themes", candidate, profile) !== null);
  const changed = preferences({ ...value, currentlyInterestedIn: value.currentlyInterestedIn.filter(term => term !== "Interest 95") });
  assert.notEqual(profileKey([], value), profileKey([], changed));
  assert.ok(discoveryPlans(profile, categoryIDs, "google-books").length <= 9, "removing selection caps does not remove provider request budgets");
});

test("Witchcraft is a nonfiction preference while explicit fiction classifications keep precedence", () => {
  const value = preferences({ preferredCategory: "nonfiction", favoriteNonfictionGenres: ["Witchcraft"], recommendationStyle: "follow_preferences" });
  const candidate = book("witchcraft-nonfiction", { genres: ["Witchcraft"], subjects: [] });
  const evidence = preferenceEvidence(candidate, value);
  assert.equal(evidence.categoryMatch, true);
  assert.equal(evidence.favorites, 1);
  assert.ok(recommendationScore("genres", candidate, buildProfile([], [], value)) !== null);
  assert.equal(preferenceEvidence(book("witchcraft-novel", { genres: ["Fiction"], subjects: ["Witchcraft"] }), value).categoryMatch, false);
});

test("Follow My Preferences puts explicit choices ahead of strong conflicting reading-history evidence", () => {
  const value = preferences({ preferredCategory: "fiction", favoriteFictionGenres: ["Romance"], recommendationStyle: "follow_preferences" });
  const profile = buildProfile([seed()], [], value);
  const selected = book("romance", { genres: ["Romance"], subjects: [] });
  const historical = book("history", { authors: ["Known Author"] });
  const nonfiction = book("science", { genres: ["Nonfiction", "Science"], subjects: ["Dragons"] });
  assert.ok(recommendationScore("similar", selected, profile) > recommendationScore("similar", historical, profile));
  assert.equal(recommendationScore("similar", historical, profile), null);
  assert.equal(recommendationScore("similar", nonfiction, profile), null);
  assert.equal(rankCategories([historical, selected, nonfiction], profile, [seed()], ["similar"]).get("similar")[0].id, "romance");
});

test("Blend My Interests combines explicit genres, current interests and only Finished history", () => {
  const value = preferences({ favoriteFictionGenres: ["Romance"], currentlyInterestedIn: ["Found family"] });
  const profile = buildProfile([seed(), seed("reading", "Reading", { genres: ["Horror"] })], [], value);
  assert.ok(profile.genres.has("romance") && profile.genres.has("fantasy"));
  assert.ok(profile.themes.has("found family"));
  assert.equal(profile.genres.has("horror"), false);
  assert.ok(recommendationScore("similar", book("history"), profile) !== null);
  assert.ok(recommendationScore("genres", book("explicit", { genres: ["Romance"], subjects: [] }), profile) !== null);
});

test("Surprise Me broadens discovery without changing author or related-book section meanings", () => {
  const value = preferences({ preferredCategory: "both", favoriteFictionGenres: ["Romance"], recommendationStyle: "surprise_me" });
  const profile = buildProfile([seed()], [], value);
  const unfamiliar = book("unfamiliar", { genres: ["Nonfiction", "History"], subjects: ["Ancient Egypt"] });
  assert.ok(recommendationScore("discovery", unfamiliar, profile) !== null);
  assert.equal(recommendationScore("authors-read", unfamiliar, profile), null);
  assert.equal(recommendationScore("related", unfamiliar, profile), null);
  assert.equal(recommendationScore("discovery", unfamiliar, buildProfile([seed()], [])), null);
  const plans = discoveryPlans(profile, ["discovery"], "google-books");
  assert.ok(plans.some(plan => plan.terms.includes("Nonfiction")));
  const manyInterests = preferences({ favoriteFictionGenres: ["Fantasy", "Mystery", "Romance", "Thriller"], currentlyInterestedIn: ["Dragons", "Ghosts", "Found family", "Time travel"], recommendationStyle: "surprise_me" });
  assert.ok(discoveryPlans(buildProfile([seed()], [], manyInterests), categoryIDs, "google-books").some(plan => plan.terms.includes("Nonfiction")));
});

test("fiction and nonfiction selections stay separate and Science never matches Science Fiction", () => {
  const value = preferences({ preferredCategory: "nonfiction", favoriteFictionGenres: ["Romance"], favoriteNonfictionGenres: ["Science"] });
  const profile = buildProfile([], [], value);
  assert.equal(profile.genres.has("romance"), false);
  assert.ok(profile.genres.has("science"));
  const fictional = preferenceEvidence(book("sci-fi", { genres: ["Science Fiction"], subjects: [] }), value);
  assert.equal(fictional.favorites, 0);
  assert.equal(fictional.opposedCategory, true);
  assert.equal(preferenceEvidence(book("real-science", { genres: ["Science"], subjects: [] }), value).favorites, 1);
  assert.equal(preferenceEvidence(book("historical-novel", { genres: ["Fiction"], subjects: ["History", "Science"] }), value).categoryMatch, false);
  assert.equal(preferenceEvidence(book("about-fantasy", { genres: ["Nonfiction"], subjects: ["Fantasy", "Science"] }), value).categoryMatch, true);
});

test("preferences and current interests produce bounded independent discovery plans before historical interests", () => {
  const value = preferences({ favoriteFictionGenres: ["Romance"], currentlyInterestedIn: ["Found family"] });
  const profile = buildProfile([seed()], [], value);
  for (const provider of ["hardcover", "google-books", "open-library"]) {
    const plans = discoveryPlans(profile, ["genres", "themes", "discovery"], provider);
    assert.deepEqual(plans[0].terms, ["Romance", "Found family"]);
    assert.ok(plans.length <= 10);
  }
  assert.deepEqual(value.favoriteFictionGenres, ["Romance"]);
});

test("preference-only users can generate catalogs while every owned status remains excluded", async () => {
  const value = preferences({ favoriteFictionGenres: ["Romance"], recommendationStyle: "follow_preferences" });
  const candidates = Array.from({ length: 24 }, (_, index) => book(`romance-${index}`, { genres: ["Romance"], subjects: [] }));
  const provider = fixtureProvider("google-books", candidates);
  const library = [seed("owned", "Reading", { title: candidates[0].title, author: candidates[0].authors[0], isbn: "" })];
  const result = await new LoomeyRecommendationEngine(new MemoryStore(), [provider]).catalogs(library, undefined, false, "preferences-test", categoryIDs, value);
  assert.ok(result.catalogs.length >= 3);
  assert.ok(result.catalogs.every(row => row.books.length >= 2));
  assert.equal(result.catalogs.flatMap(row => row.books).some(book => book.id === candidates[0].id), false);
  assert.deepEqual(provider.calls.find(call => call[0] === "resolve")[1], []);
  assert.equal(result.catalogs.some(row => row.id === "authors-read" || row.id === "related"), false);
});

test("preference cache keys invalidate on meaningful changes but ignore ordering and unfinished book signals", async () => {
  const a = preferences({ favoriteFictionGenres: ["Fantasy", "Romance"] });
  const b = preferences({ favoriteFictionGenres: ["Romance", "Fantasy"] });
  assert.equal(profileKey([seed()], a), profileKey([seed()], b));
  assert.notEqual(profileKey([seed()], a), profileKey([seed()]));
  for (const changed of [preferences({ ...a, preferredCategory: "fiction" }), preferences({ ...a, currentlyInterestedIn: ["Dragons"] }), preferences({ ...a, recommendationStyle: "surprise_me" })]) assert.notEqual(profileKey([seed()], a), profileKey([seed()], changed));
  const store = new MemoryStore();
  const provider = fixtureProvider("google-books", Array.from({ length: 24 }, (_, index) => book(`persist-${index}`)));
  await new LoomeyRecommendationEngine(store, [provider]).catalogs([seed()], undefined, false, "test", categoryIDs, a);
  const unavailable = fixtureProvider("google-books", [], true);
  const restarted = new LoomeyRecommendationEngine(store, [unavailable]);
  const cached = await restarted.requestCatalogs([seed()], false, "test", categoryIDs, a);
  assert.ok(cached.catalogs.length);
  assert.equal(cached.state, "ready");
  assert.equal(unavailable.calls.length, 0);
  const previous = cached.catalogs.flatMap(row => row.books).map(book => book.id);
  const failed = await restarted.catalogs([seed()], undefined, true, "test", ["genres"], a);
  assert.ok(failed.catalogs.flatMap(row => row.books).some(book => previous.includes(book.id)));
});

const knowledgeRow = (changes = {}) => ({ id: "12345678-1234-1234-1234-123456789abc", title: "<b>Stored Novel</b> (Paperback)", language: "eng", authors: ["Stored Writer"],
  description: "Stored description", genres: ["Fantasy"], subjects: ["Dragons", "Political intrigue"], tags: ["Found family"],
  isbns: ["0140328726"], provider_ids: { hardcover: ["42"] }, identifiers: [{ provider: "google-books", id: "stored-volume" }],
  source_names: ["hardcover"], cover_url: "https://covers.example.test/stored.jpg", cover_urls: ["invalid", "https://covers.example.test/alternate.jpg"],
  series: [{ id: "12345678-1234-1234-1234-000000000000", name: "Stored Series", position: "2" }], related: ["pg_12345678123412341234000000000000"],
  pages: 300, publisher: "Stored Publisher", first_published_year: 2024, popularity: 20, ...changes });

test("PostgreSQL rows normalize existing identifiers, editions, covers and provenance without inventing missing metadata", () => {
  const result = knowledgeBook(knowledgeRow());
  assert.equal(result.title, "Stored Novel");
  assert.deepEqual(result.isbns, ["9780140328721"]);
  assert.deepEqual(result.providerIDs, { hardcover: ["42"], "google-books": ["stored-volume"] });
  assert.equal(result.coverUrls.length, 2);
  assert.equal(result.pages, 300);
  assert.equal(result.series[0].position, 2);
  assert.deepEqual(result.knowledgeWorkIDs, [result.id]);
  for (const changes of [{ authors: null }, { title: "" }, { language: "fre" }, { language: null }, { id: "invalid" }]) assert.equal(knowledgeBook(knowledgeRow(changes)), null);
  const partial = knowledgeBook(knowledgeRow({ provider_ids: null, identifiers: null, series: null, isbns: null, description: null, cover_urls: null, cover_url: null, pages: null }));
  assert.ok(partial && !partial.coverUrls.length && !partial.isbns.length && partial.pages === null);
});

test("PostgreSQL searches use bounded parameterized read-only transactions over the existing schema", async () => {
  const queries = []; let released = false;
  const pool = { async connect() { return { async query(config) { queries.push(config); return { rows: config.text.startsWith("SELECT") ? [knowledgeRow()] : [] }; }, release(error) { assert.equal(error, undefined); released = true; } }; } };
  const result = await queryKnowledgeBooks({ terms: ["Romance'); DROP TABLE bk_jobs;--"], authors: ["Known Author"], titles: ["Finished Novel"], isbns: ["0140328726"],
    seriesNames: ["River & Stone"], workIDs: ["pg_12345678123412341234123456789abc"], relatedTo: ["pg_12345678123412341234000000000000"], category: "fiction", limit: 900 }, pool);
  assert.equal(result.length, 1);
  assert.equal(queries[0].text, "BEGIN READ ONLY");
  assert.match(queries[1].text, /statement_timeout = '1500ms'/);
  const query = queries.find(query => query.text.startsWith("SELECT"));
  assert.doesNotMatch(query.text, /DROP TABLE|Known Author|Finished Novel|River & Stone|INSERT INTO|UPDATE bk_|DELETE FROM/);
  assert.ok(query.values.some(value => Array.isArray(value) && value.includes("9780140328721")));
  assert.ok(query.values.some(value => Array.isArray(value) && value.includes("river stone")));
  assert.equal(query.values.at(-1), 160);
  assert.match(query.text, /bk_work_authors|bk_work_series|bk_related|bk_provider_ids/);
  assert.match(query.text, /w.language IN \('eng','en'\)/);
  assert.equal(queries.at(-1).text, "COMMIT");
  assert.ok(queries.every(query => query.query_timeout === 2000));
  assert.ok(released);
});

test("empty knowledge searches do not connect; failed SQL disposes the checked-out connection", async () => {
  assert.deepEqual(await queryKnowledgeBooks({ terms: [] }, { connect() { assert.fail("no unbounded catalog scan"); } }), []);
  let releaseError;
  const failure = new Error("database unavailable");
  const pool = { async connect() { return { async query(config) { if (config.text.startsWith("SELECT")) throw failure; return { rows: [] }; }, release(error) { releaseError = error; } }; } };
  await assert.rejects(queryKnowledgeBooks({ terms: ["Fantasy"] }, pool), failure);
  assert.equal(releaseError, failure);
});

test("knowledge adapter caches and coalesces reads, and forwards category, author, series and related identifiers", async () => {
  const requests = [];
  const source = new PostgresBookKnowledgeSource(new MemoryStore(), async query => { requests.push(query); return [knowledgeBook(knowledgeRow())]; }, () => true);
  const value = preferences({ preferredCategory: "fiction", favoriteFictionGenres: ["Fantasy"] });
  const plan = { key: "test", kind: "interests", categories: ["genres"], terms: ["Fantasy"], tagIDs: [], workIDs: [] };
  await Promise.all([source.discover(plan, context(), value), source.discover(plan, context(), value)]);
  await source.discover(plan, context(), value);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].category, "fiction");
  await source.discover({ ...plan, kind: "author", author: "Known Author" }, context(), value);
  await source.discover({ ...plan, kind: "series", seriesName: "Stored Series" }, context(), value);
  await source.discover({ ...plan, kind: "related", workIDs: ["hc_42", "pg_12345678123412341234123456789abc"] }, context(), value);
  assert.deepEqual(requests[1].authors, ["Known Author"]);
  assert.deepEqual(requests[2].seriesNames, ["Stored Series"]);
  assert.deepEqual(requests[3].providerIDs, [{ provider: "hardcover", id: "42" }]);
  assert.equal(requests[3].workIDs.length, 1);
});

test("sufficient PostgreSQL categories populate all seven existing sections without calling any external provider", async () => {
  const candidates = Array.from({ length: 54 }, (_, index) => book(`stored-${index}`, index < 4 ? { authors: ["Known Author"] } : {}));
  const reads = [];
  const source = { available: () => true, async resolve(sources) { reads.push(["resolve", sources]); return []; }, async discover(plan) { reads.push(["discover", plan]); return candidates; } };
  const providers = ["hardcover", "google-books", "open-library"].map(name => fixtureProvider(name, [], true));
  const store = new MemoryStore();
  const engine = new LoomeyRecommendationEngine(store, providers, undefined, 180000, source);
  const result = await engine.catalogs([seed()]);
  assert.equal(result.catalogs.length, 7);
  assert.ok(result.catalogs.every(row => row.books.length >= 4));
  assert.ok(providers.every(provider => provider.calls.length === 0));
  const count = reads.length;
  const restarted = new LoomeyRecommendationEngine(store, providers, undefined, 180000, source);
  assert.equal((await restarted.requestCatalogs([seed()])).catalogs.length, 7);
  assert.equal(reads.length, count);
});

test("underfilled PostgreSQL sections fall back without querying already-sufficient author categories", async () => {
  const stored = Array.from({ length: 4 }, (_, index) => book(`owned-author-${index}`, { authors: ["Known Author"], genres: [], subjects: [] }));
  const source = { available: () => true, async resolve() { return []; }, async discover(plan) { return plan.kind === "author" ? stored : []; } };
  const provider = fixtureProvider("google-books", Array.from({ length: 48 }, (_, index) => book(`fallback-${index}`)));
  const result = await new LoomeyRecommendationEngine(new MemoryStore(), [provider], undefined, 180000, source).catalogs([seed()]);
  assert.ok(result.catalogs.some(row => row.id === "authors-read" && row.books.length === 4));
  assert.ok(result.catalogs.length >= 5);
  assert.ok(provider.calls.filter(call => call[0] === "discover").every(call => !call[1].categories.includes("authors-read")));
});

test("empty, broken or unconfigured PostgreSQL never blocks existing external discovery", async () => {
  for (const mode of ["empty", "failure", "disabled"]) {
    const source = { available: () => mode !== "disabled", async resolve() { if (mode === "failure") throw new Error("TLS"); return []; },
      async discover() { if (mode === "failure") throw new Error("timeout"); return []; } };
    const provider = fixtureProvider("google-books", Array.from({ length: 30 }, (_, index) => book(`${mode}-${index}`)));
    const result = await new LoomeyRecommendationEngine(new MemoryStore(), [provider], undefined, 180000, source).catalogs([seed()]);
    assert.ok(result.catalogs.length >= 4, mode);
    assert.ok(provider.calls.some(call => call[0] === "discover"));
  }
});

test("PostgreSQL and external editions deduplicate by provider aliases, ISBN and preserved graph identities", () => {
  const stored = knowledgeBook(knowledgeRow({ title: "Same Work", authors: ["Same Author"], related: [] }));
  const external = book("hc_42", { title: "Same Work (Hardcover)", authors: ["Same Author"], providerIDs: { hardcover: ["42"] }, isbns: ["9780140328721"] });
  const merged = mergeCandidates([stored, external]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].knowledgeWorkIDs, stored.knowledgeWorkIDs);
  const profile = buildProfile([seed("read", "Finished", { title: "Same Work", author: "Same Author" })], [stored]);
  const related = book("next", { relatedIDs: stored.knowledgeWorkIDs });
  assert.equal(relevance(related, profile).related, true);
  assert.equal(rankCategories([stored, external], profile, [seed("read", "Archived", { isbn: "0140328726" })], ["similar"]).get("similar").length, 0);
});

test("all recommendation styles respect selected fiction/nonfiction across every section", () => {
  for (const style of ["follow_preferences", "blend_interests", "surprise_me"]) {
    const value = preferences({ preferredCategory: "nonfiction", favoriteNonfictionGenres: ["History"], recommendationStyle: style });
    const profile = buildProfile([seed()], [], value);
    const fictional = book("fiction", { authors: ["Known Author"], genres: ["Fantasy", "Science Fiction"] });
    for (const category of categoryIDs) assert.equal(recommendationScore(category, fictional, profile), null, `${style}:${category}`);
  }
});

test("preference request data flows through PostgreSQL row normalization into populated saved sections and details", async () => {
  const value = preferences({ preferredCategory: "fiction", favoriteFictionGenres: ["Fantasy", "Mystery"], currentlyInterestedIn: ["Dragons"], recommendationStyle: "follow_preferences" });
  const rows = Array.from({ length: 54 }, (_, index) => knowledgeRow({ id: `12345678-1234-1234-1234-${String(index + 1).padStart(12, "0")}`,
    title: `Stored Recommendation ${index} (Paperback)`, authors: [index < 4 ? "Known Author" : `Catalog Author ${index}`],
    genres: [index % 2 ? "Fantasy" : "Mystery"], isbns: [], provider_ids: {}, identifiers: [{ provider: "google-books", id: `pg-fixture-${index}` }],
    cover_url: `https://covers.example.test/pg-${index}.jpg`, cover_urls: [], series: [] }));
  const executed = [];
  const pool = { async connect() { return { async query(config) { executed.push(config); return { rows: config.text.startsWith("SELECT") && config.values[0].length ? rows : [] }; }, release() {} }; } };
  const store = new MemoryStore();
  const source = new PostgresBookKnowledgeSource(store, search => queryKnowledgeBooks(search, pool), () => true);
  const provider = fixtureProvider("google-books", [], true);
  const engine = new LoomeyRecommendationEngine(store, [provider], undefined, 180000, source);
  const result = await engine.catalogs([seed(), seed("reading", "Reading", { title: rows[4].title, author: rows[4].authors[0], isbn: "", genres: ["Horror"] })], undefined, false, "pg-pipeline", categoryIDs, value);
  assert.equal(result.catalogs.length, 7);
  assert.ok(result.catalogs.every(row => row.books.length >= 4));
  assert.ok(result.catalogs.flatMap(row => row.books).every(book => !book.title.endsWith("(Paperback)") && book.coverUrl.startsWith("https://") && book.author));
  assert.equal(result.catalogs.flatMap(row => row.books).some(book => book.title === "Stored Recommendation 4"), false);
  assert.equal(provider.calls.length, 0);
  assert.ok(executed.some(query => query.text.startsWith("SELECT") && query.values.some(value => typeof value === "string" && value.includes("fiction"))));
  const genres = result.catalogs.find(row => row.id === "genres");
  assert.ok(new Set(genres.books.flatMap(book => book.genres)).size >= 2);
  const card = result.catalogs[0].books[0];
  assert.equal((await engine.libraryMetadata(card.id)).title, card.title);
  const restarted = new LoomeyRecommendationEngine(store, [], undefined, 180000, source);
  const cached = await restarted.requestCatalogs([seed()], false, "pg-pipeline", categoryIDs, value);
  assert.equal(cached.catalogs.length, 7);
});

test("an idle PostgreSQL pool error is handled by API wiring without terminating the process", () => {
  const { bookPool } = require("../src/bookKnowledge/db.ts");
  assert.ok(bookPool.listenerCount("error") > 0);
  assert.doesNotThrow(() => bookPool.emit("error", Object.assign(new Error("isolated idle connection failure"), { code: "ECONNRESET" })));
});

test("request-side PostgreSQL imports never collect books or invoke the protected weekly worker", () => {
  for (const path of ["src/bookKnowledge/queries.ts", "src/bookKnowledge/knowledgeProvider.ts", "src/services/loomeyRecommendations/knowledgeSource.ts", "src/services/loomeyRecommendations/engine.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /(?:from|import\s*)[\s\S]{0,30}["'][^"']*\/(?:worker|runner|growth|jobs|sourceBridge)["']/);
    assert.doesNotMatch(source, /\benqueue\s*\(|\b(?:seedKnowledge|runKnowledgeWorker|scheduleDueWork|ingestProviderBook)\s*\(/);
  }
  const runner = readFileSync(new URL("../src/bookKnowledge/runner.ts", import.meta.url), "utf8");
  assert.match(runner, /const RUN_LIMIT_MS = 5 \* 60 \* 1000/);
});

test("existing catalog route validates and forwards explicit preferences without requiring another login", async () => {
  const calls = [];
  const result = { state: "ready", catalogs: [], partial: false };
  const service = { async requestCatalogs(...args) { calls.push(["progressive", ...args]); return result; }, async catalogs(...args) { calls.push(["awaited", ...args]); return result; } };
  const router = createAutomaticCatalogRouter({ service, client: {}, limit: async () => {} });
  const request = body => new Promise((resolve, reject) => {
    const response = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.emit("finish"); resolve({ status: this.statusCode, value, headers: this.headers }); } });
    router.handle({ method: "POST", url: "/", path: "/", body, ip: "unit-test", socket: {}, header() { return undefined; } }, response, reject);
  });
  const value = preferences({ preferredCategory: "nonfiction", favoriteNonfictionGenres: ["History"], currentlyInterestedIn: ["Ancient Egypt"] });
  assert.equal((await request({ books: [seed()], progressive: true, preferences: value })).status, 200);
  assert.deepEqual(calls[0].at(-1), value);
  assert.equal((await request({ books: [seed()], preferences: value })).status, 200);
  assert.deepEqual(calls[1].at(-1), value);
  assert.equal((await request({ books: [seed()], progressive: true })).status, 200);
  assert.equal(calls[2].at(-1), undefined);
  const invalid = await request({ books: [seed()], progressive: true, preferences: { ...value, recommendationStyle: "invalid" } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.value.error, "INVALID_READING_PREFERENCES");
  assert.equal(calls.length, 3);
});

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
  const google = (i, known = false) => ({ id: `volume${i}`, volumeInfo: { title: i === "seed" ? "Completed Novel" : `Google Novel ${i}`, authors: [known ? "Known Author" : `Google Writer ${i}`], language: "en", publishedDate: "2024-05-01", description: "Provider description", categories: ["Fantasy", "Dragons", "Political intrigue"], imageLinks: { medium: `https://books.google.com/cover${i}.jpg` }, ...(i === "seed" ? { industryIdentifiers: [{ type: "ISBN_13", identifier: "9780140328721" }] } : {}) } });
  const ol = (i, known = false) => ({ key: `/works/OL${i === "seed" ? 999 : i}W`, title: i === "seed" ? "Completed Novel" : `Library Novel ${i}`, author_name: [known ? "Known Author" : `Library Writer ${i}`], first_publish_year: 2024, subject: ["Fantasy", "Dragons", "Political intrigue"], editions: { docs: [{ key: `/books/OL${i === "seed" ? 999 : i}M`, title: i === "seed" ? "Completed Novel" : `Library Novel ${i}`, language: ["eng"], ...(i === "seed" ? { isbn: ["9780140328721"] } : {}) }] } });
  const hc = (i, known = false) => ({ ...hardcoverRaw(), release_year: 2024, id: Number(i), title: i === 999 ? "Completed Novel" : `Hardcover Novel ${i}`, contributions: [{ contribution: "Author", author: { id: known ? 1 : 1000 + i, name: known ? "Known Author" : `Hardcover Writer ${i}` } }], book_series: [], cached_tags: { Genre: [{ tag: "Fantasy" }] }, taggings: [{ tag: { id: 33, tag: "Dragons" } }, { tag: { id: 34, tag: "Political intrigue" } }], editions: [{ id: i + 5000, title: i === 999 ? "Completed Novel" : `Hardcover Novel ${i}`, language_id: 8, image: { url: `https://images.hardcover.app/${i}.jpg` }, ...(i === 999 ? { isbn_13: "9780140328721" } : {}) }] });
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
