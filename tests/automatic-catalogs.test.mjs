import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { SignJWT } from "jose";
import { BookDatabaseClient, parsePage, providerURL } from "../dist/services/bookDatabaseClient.js";
import { AutomaticCatalogService, canonicalISBN, matchesIdentity, parseLibrary, similarity, validISBN } from "../dist/services/automaticCatalogService.js";
import { CatalogError, mongoCatalogStore } from "../dist/services/automaticCatalogStore.js";
import { createAutomaticCatalogRouter } from "../dist/routes/automaticCatalogs.js";
import { verifyCatalogSession, exchangeCatalogSession } from "../dist/services/catalogAuth.js";
import { independentLibraryMetadata } from "../dist/services/catalogLibraryMetadata.js";

class MemoryStore {
  values = new Map(); locks = new Map(); reservations = 0; purges = 0; quota = Infinity;
  async get(key) { const v = this.values.get(key); return v?.expiresAt > Date.now() ? v.value : undefined; }
  async set(key, value, expiresAt) { this.values.set(key, { value, expiresAt: expiresAt.getTime() }); }
  async claim(key, owner) { if (this.locks.has(key)) return false; this.locks.set(key, owner); return true; }
  async release(key, owner) { if (this.locks.get(key) === owner) this.locks.delete(key); }
  async reserve() { if (this.reservations >= this.quota) throw new CatalogError("PROVIDER_QUOTA_EXHAUSTED", 429); this.reservations++; }
  async purge() { this.values.clear(); this.purges++; }
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const resource = (id, title = "Book") => ({ id, title, _embedded: { authors: [{ id: "author", name: "Author" }], subjects: [{ id: "s1", name: "Ocean exploration" }, { id: "s2", name: "Friendship" }] } });
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
  const ambiguous = new AutomaticCatalogService(client(async () => json(page("books", [resource("one"), resource("two")]))), new MemoryStore());
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

test("catalog output caches per verified account and library fingerprint", async () => {
  let builds = 0;
  const c = {
    assertActive: async () => Date.now() + 3600_000,
    get: async () => ({}),
  };
  const store = new MemoryStore();
  const service = new AutomaticCatalogService(c, store);
  service.build = async () => { builds++; return { catalogs: [], generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), partial: false }; };
  const books = parseLibrary({ books: [{ id: "one", title: "Book", author: "Author", rating: 5 }] });
  await Promise.all([service.catalogs("alice", books), service.catalogs("alice", books)]);
  assert.equal(builds, 1);
  await service.catalogs("alice", books); assert.equal(builds, 1);
  await service.catalogs("bob", books); assert.equal(builds, 2);
  await service.catalogs("alice", [{ ...books[0], rating: 1 }]); assert.equal(builds, 3);
  assert.equal([...store.values.keys()].some(k => k.includes("alice") || k.includes("Author")), false);
});

test("conflicting ISBN-to-work relationships fall back to exact title and author", async () => {
  const c = client(async url => {
    if (url.pathname.endsWith("/editions")) return json(page("editions", [{ id: "edition", title: "Requested Book", isbns: ["9780140328721"], _embedded: { books: [{ id: "wrong" }] } }]));
    if (url.pathname.endsWith("/wrong")) return json(resource("wrong", "Different Book"));
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
    assertActive: async () => Date.now() + 3600_000,
    get: async resourcePath => {
      const id = resourcePath.split("/")[1].split("?")[0];
      return resource(id, id === "source" ? "Source" : `Related ${id}`);
    },
    page: async (type, query) => {
      if (type === "books") return [resource("source", "Source"), ...Array.from({ length: 5 }, (_, i) => resource(`r${i}`, `Related r${i}`))];
      const id = query.bookId;
      return [{ id: `edition-${id}`, title: id === "source" ? "Source" : `Related ${id}`, _embedded: { books: [{ id }], genres: [{ id: "genre", name: "Sea adventures" }] } }];
    },
  };
  const service = new AutomaticCatalogService(c, new MemoryStore());
  service.match = async () => seed;
  const result = await service.catalogs("reader", [{ id: "local", title: "Source", author: "Author", genres: [], subjects: [], rating: 5, favorite: true, status: "Finished", activity: 10 }]);
  const books = result.catalogs.flatMap(c => c.books);
  assert.ok(books.length >= 2);
  assert.ok(books.every(b => b.id !== "source"));
  assert.equal(books.length, new Set(books.map(b => b.id)).size);
  assert.equal(books.length, new Set(books.map(b => `${b.title}|${b.author}`)).size);
});

test("new catalog endpoints reject missing or forged authentication", async () => {
  await assert.rejects(verifyCatalogSession(undefined), /UNAUTHORIZED/);
  await assert.rejects(verifyCatalogSession("Bearer forged"), /UNAUTHORIZED/);
  await assert.rejects(exchangeCatalogSession("not-a-token"));
  const app = express(); app.use(express.json());
  app.use("/catalogs", createAutomaticCatalogRouter({
    service: { catalogs: async (user, library) => ({ user, count: library.length }) }, client: {},
    verify: async header => { if (header !== "Bearer verified") throw new CatalogError("UNAUTHORIZED", 401); return "trusted-subject"; },
    exchange: async () => { throw new CatalogError("UNAUTHORIZED", 401); }, limit: async () => {},
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/catalogs`;
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    const result = await fetch(url, { method: "POST", headers: { Authorization: "Bearer verified", "Content-Type": "application/json" }, body: JSON.stringify({ userId: "spoofed", books: [] }) });
    assert.deepEqual(await result.json(), { user: "trusted-subject", count: 0 });
    assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer verified", "Content-Type": "application/json" }, body: "{}" })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("verified sessions require signature, audience, scope, and expiration", async () => {
  const oldKey = process.env.BOOKDATABASE_API_KEY;
  process.env.BOOKDATABASE_API_KEY = "fixture-session-key";
  try {
    const key = createHmac("sha256", "fixture-session-key").update("vox-api:automatic-catalog-session:v1").digest();
    const token = await new SignJWT({ scope: "loomey:automatic-catalogs" }).setProtectedHeader({ alg: "HS256" })
      .setIssuer("vox-api:loomey-catalogs").setAudience("loomey:automatic-catalogs").setSubject("verified-reader").setExpirationTime("1m").sign(key);
    assert.equal(await verifyCatalogSession(`Bearer ${token}`), "verified-reader");
    const wrongAudience = await new SignJWT({ scope: "loomey:automatic-catalogs" }).setProtectedHeader({ alg: "HS256" })
      .setIssuer("vox-api:loomey-catalogs").setAudience("different-app").setSubject("reader").setExpirationTime("1m").sign(key);
    await assert.rejects(verifyCatalogSession(`Bearer ${wrongAudience}`), /UNAUTHORIZED/);
    const expired = await new SignJWT({ scope: "loomey:automatic-catalogs" }).setProtectedHeader({ alg: "HS256" })
      .setIssuer("vox-api:loomey-catalogs").setAudience("loomey:automatic-catalogs").setSubject("reader").setExpirationTime(1).sign(key);
    await assert.rejects(verifyCatalogSession(`Bearer ${expired}`), /UNAUTHORIZED/);
  } finally { if (oldKey === undefined) delete process.env.BOOKDATABASE_API_KEY; else process.env.BOOKDATABASE_API_KEY = oldKey; }
});

test("permanent library metadata is independently sourced, not provider descriptions", async () => {
  const book = { title: "Book", author: "Author", isbn: "9780140328721", summary: "must never persist" };
  const detail = await independentLibraryMetadata(book, async () => json({ items: [{ volumeInfo: { title: "Book", authors: ["Author"], description: "<p>Independent description</p>", industryIdentifiers: [{ identifier: "9780140328721" }] } }] }));
  assert.equal(detail.summary, "Independent description"); assert.equal(detail.source, "Google Books");
  assert.equal(detail.rating, null);
});
