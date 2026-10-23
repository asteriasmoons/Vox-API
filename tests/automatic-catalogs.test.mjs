import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("ts-node/register/transpile-only");
const { BookDatabaseClient, parsePage, providerURL } = require("../src/services/bookDatabaseClient.ts");
const { AutomaticCatalogService, canonicalISBN, matchesIdentity, parseLibrary, similarity, validISBN } = require("../src/services/automaticCatalogService.ts");
const { CatalogError, mongoCatalogStore } = require("../src/services/automaticCatalogStore.ts");
const { createAutomaticCatalogRouter } = require("../src/routes/automaticCatalogs.ts");
const { independentLibraryMetadata } = require("../src/services/catalogLibraryMetadata.ts");

class MemoryStore {
  values = new Map(); locks = new Map(); reservations = 0; purges = 0; quota = Infinity;
  constructor(english = true) {
    if (english) this.values.set("english-language-v1", { value: { id: "english", iso639Code: "eng" }, expiresAt: Date.now() + 3600_000 });
  }
  async get(key) { const v = this.values.get(key); return v?.expiresAt > Date.now() ? v.value : undefined; }
  async set(key, value, expiresAt) { this.values.set(key, { value, expiresAt: expiresAt.getTime() }); }
  async claim(key, owner) { if (this.locks.has(key)) return false; this.locks.set(key, owner); return true; }
  async release(key, owner) { if (this.locks.get(key) === owner) this.locks.delete(key); }
  async reserve() { if (this.reservations >= this.quota) throw new CatalogError("PROVIDER_QUOTA_EXHAUSTED", 429); this.reservations++; }
  async purge() { this.values.clear(); this.purges++; }
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const resource = (id, title = "Book") => ({ id, title, _embedded: { authors: [{ id: "author", name: "Author" }], subjects: [{ id: "s1", name: "Ocean exploration" }, { id: "s2", name: "Friendship" }] } });
const edition = (workID, title = "Book", languageID = "english") => ({ id: `edition-${workID}`, title, isbns: ["9780140328721"], _embedded: {
  books: [{ id: workID }], authors: [{ id: "author", name: "Author" }], languages: languageID ? [{ id: languageID }] : [], genres: [{ id: "genre", name: "Sea adventures" }],
} });
const page = (type, items, next) => ({ _embedded: { [type]: items }, _link: next ? { next: { href: next } } : {} });
const client = (transport, store = new MemoryStore()) => new BookDatabaseClient(() => "fixture-key", store, transport, () => Date.now() + 3600_000);

test("HAL singular and plural links parse; invalid pages fail", () => {
  assert.equal(parsePage(page("books", [resource("one")], "/v1/books?continuationToken=x"), "books").next, "/v1/books?continuationToken=x");
  assert.equal(parsePage({ _embedded: { books: [] }, _links: { next: { href: "https://api.bookdatabase.io/v1/books?continuationToken=y" } } }, "books").next.includes("y"), true);
  assert.throws(() => parsePage({}, "books"), /INVALID_PROVIDER_RESPONSE/);
  assert.throws(() => providerURL("https://attacker.invalid/v1/books"), /INVALID_PROVIDER_LINK/);
  assert.throws(() => providerURL("https://api.bookdatabase.io/not-v1/books"), /INVALID_PROVIDER_LINK/);
  assert.equal(providerURL("books?apiKey=secret").searchParams.has("apiKey"), false);
});

test("provider responses that ignore requested identity or search filters fail closed", async () => {
  await assert.rejects(client(async () => json(resource("different-id"))).get("books/requested-id"), /PROVIDER_RESPONSE_MISMATCH/);
  await assert.rejects(client(async () => json(page("books", [resource("one", "Unrelated Title")]))).page("books", { searchQuery: "Requested Title", searchMode: "Exact" }), /PROVIDER_RESPONSE_MISMATCH/);
  await assert.rejects(client(async () => json(page("books", [resource("one")]))).page("books", { subjectId: "unrelated-subject" }), /PROVIDER_RESPONSE_MISMATCH/);
});

test("provider key stays in header; concurrent identical requests deduplicate", async () => {
  let calls = 0;
  const store = new MemoryStore();
  const c = client(async (url, options) => {
    calls++;
    assert.equal(options.headers["X-API-Key"], "fixture-key");
    assert.equal(url.href.includes("fixture-key"), false);
    assert.equal(options.redirect, "manual");
    await new Promise(r => setTimeout(r, 10));
    return json(resource("one"));
  }, store);
  const [one, two] = await Promise.all([c.get("books/one"), c.get("books/one")]);
  assert.deepEqual(one, two);
  await c.get("books/one");
  assert.equal(calls, 1); assert.equal(store.reservations, 1);
});

test("distributed cache locks coalesce requests from separate client instances", async () => {
  const store = new MemoryStore(); let calls = 0;
  const transport = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return json(resource("one")); };
  await Promise.all([client(transport, store).get("books/one"), client(transport, store).get("books/one")]);
  assert.equal(calls, 1);
});

test("shared Mongo CAS reservations enforce one call per second and durable daily quota", async () => {
  const docs = new Map();
  const Control = {
    async updateOne(filter, update) {
      if (!docs.has(filter._id)) docs.set(filter._id, { ...update.$setOnInsert });
    },
    async findOneAndUpdate(filter, update) {
      const doc = docs.get(filter._id);
      if (!doc || (filter.nextAt && doc.nextAt > filter.nextAt.$lte) || (filter.count && doc.count >= filter.count.$lt)) return null;
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$inc) doc.count += update.$inc.count;
      return doc;
    },
  };
  const models = { Control, Cache: {} };
  const firstWorker = mongoCatalogStore("rate-fixture", models, () => true);
  const secondWorker = mongoCatalogStore("rate-fixture", models, () => true);
  const starts = [];
  await Promise.all([firstWorker.reserve().then(() => starts.push(Date.now())), secondWorker.reserve().then(() => starts.push(Date.now()))]);
  starts.sort(); assert.ok(starts[1] - starts[0] >= 1000);
  const daily = [...docs.entries()].find(([key]) => key.includes(":daily:"))[1];
  assert.equal(daily.count, 2);
  daily.count = 5000;
  const restartedWorker = mongoCatalogStore("rate-fixture", models, () => true);
  await assert.rejects(restartedWorker.reserve(), /PROVIDER_QUOTA_EXHAUSTED/);
});

test("cache TTL and negative records expire without repeated upstream requests", async () => {
  const store = new MemoryStore(); let calls = 0;
  const c = client(async () => { calls++; return json({}, 404); }, store);
  assert.equal(await c.get("books/missing"), null);
  assert.equal(await c.get("books/missing"), null);
  assert.equal(calls, 1);
  for (const value of store.values.values()) value.expiresAt = 0;
  await c.get("books/missing"); assert.equal(calls, 2);
});

test("pagination follows HAL next and deduplicates records", async () => {
  let calls = 0;
  const c = client(async url => {
    calls++;
    return json(url.searchParams.has("continuationToken")
      ? page("books", [resource("one"), resource("two")])
      : page("books", [resource("one")], "https://api.bookdatabase.io/v1/books?subjectId=s1&continuationToken=opaque"));
  });
  assert.deepEqual((await c.page("books", { subjectId: "s1" }, 3)).map(b => b.id), ["one", "two"]);
  assert.equal(calls, 2);
});

test("provider errors, malformed responses, transport failures, and quota exhaustion", async () => {
  for (const response of [() => json({}, 500), () => json({ unexpected: true })]) {
    const c = client(async () => response());
    await assert.rejects(c.get("books/one"), /PROVIDER_UNAVAILABLE|INVALID_PROVIDER_RESPONSE/);
  }
  await assert.rejects(client(async () => { throw new Error("timeout"); }).get("books/one"), /PROVIDER_UNAVAILABLE/);
  let calls = 0;
  const c = client(async () => { calls++; return json({ errorCode: "NO_API_CALLS_REMAINING" }, 400); });
  await assert.rejects(c.get("books/one"), /PROVIDER_QUOTA_EXHAUSTED/);
  await assert.rejects(c.get("books/two"), /PROVIDER_QUOTA_EXHAUSTED/);
  assert.equal(calls, 1);
  const store = new MemoryStore(); store.quota = 0;
  await assert.rejects(client(async () => { assert.fail("quota must fail before fetch"); }, store).get("books/one"), /PROVIDER_QUOTA_EXHAUSTED/);
});

test("access denied and expired subscription purge cached data", async () => {
  const store = new MemoryStore();
  const c = client(async () => json({ errorCode: "INVALID_API_KEY" }, 400), store);
  await assert.rejects(c.get("books/one"), /PROVIDER_ACCESS_DENIED/);
  assert.equal(store.purges, 1);
  const expired = new BookDatabaseClient(() => "key", store, fetch, () => 0);
  await assert.rejects(expired.get("books/one"), /CATALOG_NOT_CONFIGURED/);
  assert.equal(store.purges, 2);
});

test("image content URLs are read from 302 without forwarding provider credentials", async () => {
  const c = client(async () => new Response(null, { status: 302, headers: { Location: "https://images.example/cover.jpg?signed=1" } }));
  assert.equal((await c.get("images/one/contentUrl")).contentUrl, "https://images.example/cover.jpg?signed=1");
});

test("ISBN and normalized exact title/author matching reject lookalikes", () => {
  assert.equal(validISBN("978-0-14-032872-1"), true);
  assert.equal(validISBN("0140328726"), true);
  assert.equal(canonicalISBN("0140328726"), "9780140328721");
  assert.equal(validISBN("9780140328722"), false);
  assert.equal(matchesIdentity({ title: "BÓOK!", author: "Author" }, resource("one", "Book")), true);
  assert.equal(matchesIdentity({ title: "Book", author: "Someone Else" }, resource("one", "Book")), false);
});

test("ISBN edition resolves to its work; ambiguous titles do not guess", async () => {
  const calls = [];
  const c = client(async url => {
    calls.push(url.pathname);
    if (url.pathname.endsWith("/editions")) return json(page("editions", [{ id: "edition", title: "Matilda", isbns: ["9780140328721"], _embedded: { books: [{ id: "work" }], genres: [{ id: "g1", name: "Fantasy" }] } }]));
    return json(resource("work", "Matilda"));
  });
  const service = new AutomaticCatalogService(c, new MemoryStore());
  const signal = parseLibrary({ books: [{ id: "local", title: "Matilda", author: "Author", isbn: "9780140328721" }] })[0];
  const book = await service.match(signal);
  assert.equal(book.id, "work"); assert.deepEqual(book.genres, ["Fantasy"]);
  assert.deepEqual(calls, ["/v1/editions", "/v1/books/work"]);
  const ambiguous = new AutomaticCatalogService(client(async url => json(url.pathname.endsWith("/books")
    ? page("books", [resource("one"), resource("two")]) : resource(url.pathname.split("/").at(-1)))), new MemoryStore());
  assert.equal(await ambiguous.match({ ...signal, isbn: "", title: "Book", author: "Author" }), null);
});

test("specific multi-signal similarity outranks broad categories and author alone", () => {
  const seed = { id: "seed", genres: ["Fiction", "Fantasy"], subjects: ["Friendship", "Ocean exploration"], authorIDs: ["a"] };
  const broad = { ...seed, id: "broad", genres: ["Fiction"], subjects: [], authorIDs: [] };
  const strong = { ...seed, id: "strong", authorIDs: ["new"] };
  assert.equal(similarity(broad, [seed]).score, 0);
  assert.ok(similarity(strong, [seed]).score > similarity({ ...broad, authorIDs: ["a"] }, [seed]).score);
  const promotional = { ...broad, subjects: ["New York Times bestseller", "nyt:trade-fiction-paperback=2021", "American literatures"] };
  assert.equal(similarity(promotional, [promotional]).score, 0);
  const redundant = { ...broad, subjects: ["Dune (imaginary place)", "Dune (imaginary place), fiction"] };
  assert.equal(similarity(redundant, [redundant]).subjects, 1);
});

test("catalog output caches by library fingerprint without an account", async () => {
  let builds = 0;
  const c = {
    withSignal: () => c,
    assertActive: async () => Date.now() + 3600_000,
    get: async () => ({}),
  };
  const store = new MemoryStore();
  const service = new AutomaticCatalogService(c, store);
  service.build = async () => { builds++; return { catalogs: [], generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), partial: false }; };
  const books = parseLibrary({ books: [{ id: "one", title: "Book", author: "Author", rating: 5 }] });
  await Promise.all([service.catalogs(books), service.catalogs(books)]);
  assert.equal(builds, 1);
  await service.catalogs(books); assert.equal(builds, 1);
  await service.catalogs([{ ...books[0], id: "another-library-book" }]); assert.equal(builds, 2);
  await service.catalogs([{ ...books[0], rating: 1 }]); assert.equal(builds, 3);
  assert.equal([...store.values.keys()].some(k => k.includes("another-library-book") || k.includes("Author")), false);
});

test("conflicting ISBN-to-work relationships fall back to exact title and author", async () => {
  const c = client(async url => {
    if (url.pathname.endsWith("/editions")) return json(page("editions", [{ id: "edition", title: "Requested Book", isbns: ["9780140328721"], _embedded: { books: [{ id: "wrong" }] } }]));
    if (url.pathname.endsWith("/wrong")) return json(resource("wrong", "Different Book"));
    if (url.pathname.endsWith("/edition")) return json({ id: "edition", title: "Requested Book", _embedded: { authors: [{ id: "author", name: "Author" }], books: [{ id: "wrong" }] } });
    return json(page("books", []));
  });
  const service = new AutomaticCatalogService(c, new MemoryStore());
  assert.equal(await service.match({ id: "local", title: "Requested Book", author: "Author", isbn: "9780140328721" }), null);
});

test("edition title index is a documented fallback when work-title search fails", async () => {
  const c = client(async url => {
    if (url.pathname.endsWith("/books")) return json(page("books", [resource("unrelated", "Different Title")]));
    if (url.pathname.endsWith("/editions")) return json(page("editions", [{
      id: "edition", title: "Book", _embedded: { authors: [{ id: "author", name: "Author" }], books: [{ id: "work" }], genres: [{ id: "genre", name: "Sea adventures" }] },
    }]));
    if (url.pathname.endsWith("/edition")) return json({ id: "edition", title: "Book", _embedded: { authors: [{ id: "author", name: "Author" }], books: [{ id: "work" }], genres: [{ id: "genre", name: "Sea adventures" }] } });
    return json(resource("work", "Book"));
  });
  const service = new AutomaticCatalogService(c, new MemoryStore());
  const book = await service.match({ id: "local", title: "Book", author: "Author", isbn: "" });
  assert.equal(book.id, "work");
  assert.deepEqual(book.genres, ["Sea adventures"]);
});

test("real catalog assembly excludes source and duplicate editions across shelves", async () => {
  const seed = { id: "source", title: "Source", author: "Author", genres: ["Sea adventures"], subjects: ["Ocean exploration", "Friendship"], genreIDs: ["genre"], subjectIDs: ["s1", "s2"], authorIDs: ["author"] };
  const c = {
    withSignal: () => c,
    assertActive: async () => Date.now() + 3600_000,
    get: async resourcePath => {
      const id = resourcePath.split("/")[1].split("?")[0];
      if (resourcePath.startsWith("editions/")) return edition(id.replace("edition-", ""), `Related ${id.replace("edition-", "")}`);
      return resource(id, id === "source" ? "Source" : `Related ${id}`);
    },
    page: async (type, query) => {
      if (type === "books") return [resource("source", "Source"), ...Array.from({ length: 5 }, (_, i) => resource(`r${i}`, `Related r${i}`))];
      if (!query.bookId) return [edition("source", "Source"), ...Array.from({ length: 5 }, (_, i) => edition(`r${i}`, `Related r${i}`))];
      const id = query.bookId;
      return [edition(id, id === "source" ? "Source" : `Related ${id}`)];
    },
    async *pages(...args) { yield await c.page(...args); },
  };
  const service = new AutomaticCatalogService(c, new MemoryStore());
  service.match = async () => seed;
  const result = await service.catalogs([{ id: "local", title: "Source", author: "Author", genres: [], subjects: [], rating: 5, favorite: true, status: "Finished", activity: 10 }]);
  const books = result.catalogs.flatMap(c => c.books);
  assert.ok(books.length >= 2);
  assert.ok(books.every(b => b.id !== "source"));
  assert.equal(books.length, new Set(books.map(b => b.id)).size);
  assert.equal(books.length, new Set(books.map(b => `${b.title}|${b.author}`)).size);
});

test("catalogs, details, and covers load without sign-in or a token exchange", async () => {
  const limits = [];
  const app = express(); app.use(express.json());
  app.use("/catalogs", createAutomaticCatalogRouter({
    service: { catalogs: async library => ({ count: library.length }), work: async id => id === "missing" ? null : { id } },
    client: { get: async () => ({ contentUrl: "https://images.example.test/cover.jpg" }) },
    limit: async (key, limit) => { limits.push({ key, limit }); },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/catalogs`;
    const result = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ books: [] }) });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await result.json(), { count: 0 });
    assert.deepEqual(await (await fetch(`${url}/books/work`)).json(), { id: "work" });
    assert.deepEqual(await (await fetch(`${url}/images/cover`)).json(), { url: "https://images.example.test/cover.jpg", expiresIn: 240 });
    assert.equal((await fetch(`${url}/books/missing/library-metadata`)).status, 404);
    assert.equal((await fetch(`${url}/session`, { method: "POST" })).status, 404);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400);
    assert.ok(limits.some(({ key, limit }) => key.endsWith(":images") && limit === 90));
    assert.ok(limits.some(({ key, limit }) => key.endsWith(":catalogs") && limit === 20));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("catalog request limits still reject excessive traffic without requiring sign-in", async () => {
  let generated = false;
  const app = express(); app.use(express.json());
  app.use("/catalogs", createAutomaticCatalogRouter({
    service: { catalogs: async () => { generated = true; return {}; } }, client: {},
    limit: async () => { throw new CatalogError("CATALOG_RATE_LIMITED", 429, 60); },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/catalogs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ books: [] }),
    });
    assert.equal(result.status, 429);
    assert.equal(result.headers.get("Retry-After"), "60");
    assert.deepEqual(await result.json(), { error: "CATALOG_RATE_LIMITED" });
    assert.equal(generated, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("permanent library metadata is independently sourced, not provider descriptions", async () => {
  const book = { title: "Book", author: "Author", isbn: "9780140328721", summary: "must never persist" };
  const detail = await independentLibraryMetadata(book, async () => json({ items: [{ volumeInfo: { title: "Book", authors: ["Author"], description: "<p>Independent description</p>", industryIdentifiers: [{ identifier: "9780140328721" }] } }] }));
  assert.equal(detail.summary, "Independent description"); assert.equal(detail.source, "Google Books");
  assert.equal(detail.rating, null);
});

test("a stalled provider is aborted by the catalog deadline without a second attempt", async () => {
  let calls = 0;
  const c = client(async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  });
  const service = new AutomaticCatalogService(c, new MemoryStore(), 30);
  const start = Date.now();
  await assert.rejects(service.catalogs(parseLibrary({ books: [{ id: "one", title: "Book", author: "Author", isbn: "9780140328721" }] })), /CATALOG_TIMED_OUT/);
  assert.ok(Date.now() - start < 1000);
  assert.equal(calls, 1);
});

test("shortlisted works query and verify English editions, not arbitrary linked translations", async () => {
  const paths = [];
  const c = client(async url => {
    paths.push(url.pathname);
    if (url.pathname.endsWith("/one")) return json({ ...resource("one"), _embedded: { ...resource("one")._embedded, editions: [{ id: "edition" }] } });
    assert.equal(url.searchParams.get("languageId"), "english");
    assert.equal(url.searchParams.get("bookId"), "one");
    return json(page("editions", [edition("one")]));
  });
  const book = await new AutomaticCatalogService(c, new MemoryStore()).work("one");
  assert.equal(book.isbn, "9780140328721");
  assert.equal(book.language, "eng");
  assert.deepEqual(paths, ["/v1/books/one", "/v1/editions"]);
});

test("slow optional discovery returns already verified books instead of discarding them", async () => {
  let calls = 0;
  const c = client(async (url, options) => {
    calls++;
    if (url.pathname.endsWith("/editions") && url.searchParams.has("authorId")) {
      assert.equal(url.searchParams.get("includeRelationships"), "None");
      assert.equal(url.searchParams.get("pageSize"), "12");
      assert.equal(url.searchParams.get("languageId"), "english");
      return json(page("editions", [edition("first", "First Related Book"), edition("second", "Second Related Book")]));
    }
    if (url.pathname.includes("/editions/edition-")) {
      const id = url.pathname.split("edition-")[1];
      return json(edition(id, id === "first" ? "First Related Book" : "Second Related Book"));
    }
    if (url.pathname.endsWith("/first")) return json(resource("first", "First Related Book"));
    if (url.pathname.endsWith("/second")) return json(resource("second", "Second Related Book"));
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  });
  const service = new AutomaticCatalogService(c, new MemoryStore(), 50);
  service.match = async () => ({ id: "source", title: "Source", author: "Author", genres: [], subjects: ["Ocean exploration", "Friendship"], genreIDs: [], subjectIDs: ["s1", "s2"], authorIDs: ["author"] });
  const library = parseLibrary({ books: [{ id: "local", title: "Source", author: "Author" }] });
  const response = await service.catalogs(library);
  assert.equal(response.partial, true);
  assert.equal(response.catalogs[0].id, "authors-read");
  assert.deepEqual(response.catalogs[0].books.map(book => book.id), ["first", "second"]);
  const previousCalls = calls;
  await service.catalogs(library);
  assert.equal(calls, previousCalls, "cached catalogs do not wait on a new random-book access check");
});

test("lightweight discovery still rejects unrelated hydrated books", async () => {
  const c = client(async url => {
    if (url.pathname.endsWith("/editions")) return json(page("editions", [edition("unrelated"), edition("also-unrelated")]));
    if (url.pathname.includes("/editions/edition-")) return json(edition(url.pathname.split("edition-")[1]));
    return json({ ...resource(url.pathname.split("/").at(-1)), _embedded: { authors: [{ id: "someone-else", name: "Someone Else" }], subjects: [] } });
  });
  const service = new AutomaticCatalogService(c, new MemoryStore());
  service.match = async () => ({ id: "source", title: "Source", author: "Author", genres: [], subjects: [], genreIDs: [], subjectIDs: [], authorIDs: ["author"] });
  const response = await service.catalogs(parseLibrary({ books: [{ id: "local", title: "Source", author: "Author" }] }));
  assert.deepEqual(response.catalogs, []);
});

test("progressive catalog requests return immediately and continue fetching the full result", async () => {
  const c = { assertActive: async () => Infinity };
  const service = new AutomaticCatalogService(c, new MemoryStore());
  let finish;
  let publisher;
  let builds = 0;
  const final = { catalogs: [{ id: "similar", title: "You Might Also Like", books: [{ id: "one", genres: ["Fantasy"], subjects: ["Friendship"], pages: 240, summary: "Full metadata" }] }], generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), partial: false };
  service.catalogs = async (_library, publish) => { builds++; publisher = publish; return new Promise(resolve => { finish = resolve; }); };
  const library = parseLibrary({ books: [{ id: "local", title: "Book", author: "Author" }] });
  const start = Date.now();
  assert.equal((await service.requestCatalogs(library)).state, "building");
  assert.ok(Date.now() - start < 1000);
  await service.requestCatalogs(library);
  assert.equal(builds, 1);
  await publisher({ ...final, partial: true });
  const progress = await service.requestCatalogs(library);
  assert.equal(progress.state, "building");
  assert.equal(progress.catalogs[0].books[0].summary, "Full metadata");
  finish(final);
  await new Promise(resolve => setImmediate(resolve));
  const ready = await service.requestCatalogs(library);
  assert.equal(ready.state, "ready");
  assert.deepEqual(ready.catalogs, final.catalogs);
  assert.equal(ready.partial, false);
});

test("background failures stop polling and an explicit retry can restart the fetch", async () => {
  const service = new AutomaticCatalogService({ assertActive: async () => Infinity }, new MemoryStore());
  service.catalogs = async () => { throw new CatalogError("CATALOG_TIMED_OUT", 504); };
  const library = parseLibrary({ books: [{ id: "local", title: "Book", author: "Author" }] });
  assert.equal((await service.requestCatalogs(library)).state, "building");
  await new Promise(resolve => setImmediate(resolve));
  const failed = await service.requestCatalogs(library);
  assert.equal(failed.state, "failed");
  assert.equal(failed.errorCode, "CATALOG_TIMED_OUT");
  service.catalogs = async () => ({ catalogs: [], generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), partial: false });
  assert.equal((await service.requestCatalogs(library, true)).state, "building");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await service.requestCatalogs(library)).state, "ready");
});

test("HTTP progressive polling opts in without changing existing catalog clients", async () => {
  const app = express(); app.use(express.json());
  app.use("/catalogs", createAutomaticCatalogRouter({
    service: { catalogs: async () => ({ catalogs: [], partial: false }), requestCatalogs: async () => ({ catalogs: [], partial: true, state: "building", retryAfter: 4 }) },
    client: {}, limit: async () => {},
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/catalogs`;
    const result = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ books: [], progressive: true }) });
    assert.equal(result.status, 202);
    assert.equal(result.headers.get("Retry-After"), "4");
    assert.equal((await result.json()).state, "building");
    const legacy = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ books: [] }) });
    assert.equal(legacy.status, 200);
    assert.deepEqual(await legacy.json(), { catalogs: [], partial: false });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("HAL pages publish full records before a later page times out", async () => {
  const c = client(async (url, options) => {
    if (url.searchParams.has("continuationToken")) return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    if (url.pathname.endsWith("/editions")) return json(page("editions", [edition("first", "First Book"), edition("second", "Second Book")], "https://api.bookdatabase.io/v1/editions?authorId=author&languageId=english&includeRelationships=None&continuationToken=next"));
    if (url.pathname.includes("/editions/edition-")) {
      const id = url.pathname.split("edition-")[1];
      return json(edition(id, id === "first" ? "First Book" : "Second Book"));
    }
    return json(resource(url.pathname.split("/").at(-1), url.pathname.endsWith("/first") ? "First Book" : "Second Book"));
  });
  const service = new AutomaticCatalogService(c, new MemoryStore(), 50);
  service.match = async () => ({ id: "source", title: "Source", author: "Author", genres: [], subjects: [], genreIDs: [], subjectIDs: [], authorIDs: ["author"] });
  const snapshots = [];
  const response = await service.catalogs(parseLibrary({ books: [{ id: "local", title: "Source", author: "Author" }] }), async snapshot => { snapshots.push(snapshot); });
  assert.equal(snapshots[0].catalogs[0].books.length, 2);
  assert.deepEqual(snapshots[0].catalogs[0].books[0].subjects, ["Ocean exploration", "Friendship"]);
  assert.equal(response.partial, true);
  assert.equal(response.catalogs[0].books.length, 2);
});

test("twelve diverse source books are matched, instead of stopping after four", async () => {
  const c = client(async url => json(page("books", [])));
  const service = new AutomaticCatalogService(c, new MemoryStore());
  const matched = [];
  service.match = async signal => { matched.push(signal.id); return { id: signal.id, title: signal.title, author: "Author", genres: [], subjects: [], genreIDs: [], subjectIDs: [], authorIDs: [] }; };
  await service.catalogs(parseLibrary({ books: Array.from({ length: 16 }, (_, i) => ({ id: `seed-${i}`, title: `Book ${i}`, author: `Author ${i % 8}` })) }));
  assert.equal(matched.length, 12);
});

test("English resource identity is resolved from ISO metadata and temporarily cached", async () => {
  const store = new MemoryStore(false);
  const calls = [];
  const c = client(async url => {
    calls.push(url.pathname);
    const id = url.pathname.split("/").at(-1);
    return json({ id, iso639Code: id === "actual-english-id" ? "eng" : "nld", englishName: id === "actual-english-id" ? "English" : "Dutch" });
  }, store);
  const service = new AutomaticCatalogService(c, store);
  assert.equal(await service.englishLanguage(c, ["dutch", "actual-english-id"]), "actual-english-id");
  assert.equal(await service.englishLanguage(c), "actual-english-id");
  assert.deepEqual(calls, ["/v1/languages/dutch", "/v1/languages/actual-english-id"]);
});

test("language lookup follows documented pagination without inventing a language search filter", async () => {
  const store = new MemoryStore(false);
  let calls = 0;
  const c = client(async url => {
    calls++;
    assert.equal(url.pathname, "/v1/languages");
    assert.equal(url.searchParams.has("searchQuery"), false);
    return json(url.searchParams.has("continuationToken")
      ? page("languages", [{ id: "actual-english-id", iso639Code: "eng", englishName: "English" }])
      : page("languages", [{ id: "dutch", iso639Code: "nld", englishName: "Dutch" }], "/v1/languages?continuationToken=english-page"));
  }, store);
  assert.equal(await new AutomaticCatalogService(c, store).englishLanguage(c), "actual-english-id");
  assert.equal(calls, 2);
});

test("English edition title and cover take precedence over a foreign work title", async () => {
  const store = new MemoryStore();
  const c = client(async url => {
    if (url.pathname.endsWith("/work")) return json({ ...resource("work", "Kinderen van Duin"), description: "Nederlandse beschrijving", _embedded: { ...resource("work")._embedded, images: [{ id: "dutch-cover" }] } });
    const english = edition("work", "Children of Dune");
    english.description = "English edition description";
    english._embedded.images = [{ id: "english-cover" }];
    return json(page("editions", [english]));
  }, store);
  const book = await new AutomaticCatalogService(c, store).work("work");
  assert.equal(book.title, "Children of Dune");
  assert.equal(book.language, "eng");
  assert.equal(book.summary, "English edition description");
  assert.equal(book.imageID, "english-cover");
});

test("foreign and language-unknown editions cannot enter recommendations", async () => {
  const store = new MemoryStore();
  const c = client(async url => json(url.pathname.endsWith("/books/work") ? resource("work") : page("editions", [])), store);
  const service = new AutomaticCatalogService(c, store);
  assert.equal(service.map(resource("work"), edition("work", "Book", "dutch"), "english"), null);
  assert.equal(service.map(resource("work"), edition("work", "Book", null), "english"), null);
  assert.equal(service.map(resource("work"), edition("different"), "english"), null);
  assert.equal(await service.work("work"), null, "no arbitrary foreign-edition fallback");
  await assert.rejects(client(async () => json(page("editions", [edition("work", "Book", "dutch")]))).page("editions", { languageId: "english", includeRelationships: "All" }), /PROVIDER_RESPONSE_MISMATCH/);
});

test("author, genre, and subject discovery are all used and editions carry the English filter", async () => {
  const plans = [];
  const c = client(async url => {
    const query = Object.fromEntries(url.searchParams);
    plans.push({ collection: url.pathname.split("/").at(-1), ...query });
    if (url.pathname.endsWith("/editions")) assert.equal(query.languageId, "english");
    return json(page(url.pathname.split("/").at(-1), []));
  });
  const service = new AutomaticCatalogService(c, new MemoryStore());
  service.match = async () => ({ id: "source", title: "Source", author: "Author", genres: ["Sea adventures"], subjects: ["Ocean exploration", "Friendship"], genreIDs: ["genre"], subjectIDs: ["s1", "s2"], authorIDs: ["author"] });
  await service.catalogs(parseLibrary({ books: [{ id: "local", title: "Source", author: "Author" }] }));
  assert.ok(plans.some(query => query.authorId === "author"));
  assert.ok(plans.some(query => query.genreId === "genre"));
  assert.ok(plans.some(query => query.subjectId === "s1"));
  assert.ok(plans.every(query => query.pageSize === "12"));
});

test("catalog diagnostics redact private search and credential values", () => {
  const { providerRequestFields } = require("../src/services/catalogDiagnostics.ts");
  const fields = providerRequestFields(new URL("https://api.bookdatabase.io/v1/editions?isbn=9780140328721&searchQuery=PrivateTitle&apiKey=secret&continuationToken=opaque&languageId=english"));
  const serialized = JSON.stringify(fields);
  for (const privateValue of ["9780140328721", "PrivateTitle", "secret", "opaque"]) assert.equal(serialized.includes(privateValue), false);
  assert.equal(fields.parameters.languageId, "english");
});
