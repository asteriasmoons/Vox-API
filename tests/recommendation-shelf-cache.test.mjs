import assert from "node:assert/strict";
import test from "node:test";

process.env.GROQ_API_KEY = "test-groq-key";
process.env.MISTRAL_API_KEY = "test-mistral-key";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENROUTER_MODEL = "test-openrouter-model";

const { createRecommendationCollectionBuilder } = await import(
  "../dist/services/recommendationCollectionService.js"
);
const { createGeneratedRecommendationShelfService } = await import(
  "../dist/services/generatedRecommendationShelfService.js"
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shelfResponse(label = "Generated") {
  return {
    collections: [
      {
        id: "similar-to-your-favorites",
        title: "Similar To Your Favorites",
        description: "Saved shelf",
        reason: "Test shelf",
        bookCount: 15,
        books: Array.from({ length: 15 }, (_, index) => ({
          title: `${label} Book ${index + 1}`,
          author: `${label} Author ${index + 1}`,
          summary: `${label} summary ${index + 1}`,
          coverUrl: `https://example.com/${label}-${index + 1}.jpg`,
          tags: ["Fantasy"],
          genres: ["Fantasy"],
          moods: ["Atmospheric"],
          tropes: ["Found family"],
          source: "Google Books",
          strategy: "closest_match",
          strategyLabel: "Closest Match",
          matchScore: 0.9,
          metadataScore: 0.8,
          finalScore: 0.85,
        })),
        previewCoverUrls: [
          `https://example.com/${label}-1.jpg`,
          `https://example.com/${label}-2.jpg`,
          `https://example.com/${label}-3.jpg`,
          `https://example.com/${label}-4.jpg`,
        ],
      },
    ],
  };
}

function engineResponse(label = "Generated") {
  return {
    recs: shelfResponse(label).collections[0].books,
    meta: {
      requestType: "genre",
      normalizedQuery: "test",
      seedResolved: false,
      candidateGroups: [{ strategy: "closest_match", count: 15 }],
      verifiedCandidateCount: 15,
    },
  };
}

function collectionInput() {
  return {
    userId: "user-cache-test",
    collectionId: "similar-to-your-favorites",
    desiredCollections: 5,
    booksPerCollection: 15,
    readerContext: {
      favoriteGenres: ["Fantasy"],
      favoriteMoods: ["Atmospheric"],
      highestRatedBooks: [
        {
          title: "Favorite Book",
          author: "Favorite Author",
          rating: 5,
        },
      ],
    },
  };
}

function deepClone(value) {
  return structuredClone(value);
}

function getByPath(doc, path) {
  return path.split(".").reduce((value, key) => value?.[key], doc);
}

function matchesOperator(actual, condition) {
  if ("$exists" in condition) {
    const exists = actual !== undefined;
    if (exists !== condition.$exists) return false;
  }
  if ("$lte" in condition) {
    if (!(actual instanceof Date)) return false;
    if (actual.getTime() > condition.$lte.getTime()) return false;
  }
  return true;
}

function matchesFilter(doc, filter) {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "$or") {
      if (!expected.some((option) => matchesFilter(doc, option))) return false;
      continue;
    }

    const actual = getByPath(doc, key);
    if (
      expected &&
      typeof expected === "object" &&
      !(expected instanceof Date) &&
      !Array.isArray(expected) &&
      Object.keys(expected).some((operator) => operator.startsWith("$"))
    ) {
      if (!matchesOperator(actual, expected)) return false;
      continue;
    }

    if (actual !== expected) return false;
  }
  return true;
}

function applyUpdate(doc, update) {
  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set)) {
      doc[key] = value;
    }
  }
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) {
      delete doc[key];
    }
  }
}

function createFakeShelfModel(initialDocs = []) {
  const docs = new Map();
  for (const doc of initialDocs) {
    docs.set(`${doc.userId}:${doc.shelfKey}`, deepClone(doc));
  }

  return {
    docs,
    findOne(filter) {
      return {
        async lean() {
          const doc = [...docs.values()].find((item) => matchesFilter(item, filter));
          return doc ? deepClone(doc) : null;
        },
      };
    },
    findOneAndUpdate(filter, update, options = {}) {
      return {
        async lean() {
          const key = `${filter.userId}:${filter.shelfKey}`;
          const existing = docs.get(key);
          if (existing) {
            if (!matchesFilter(existing, filter)) return null;
            applyUpdate(existing, update);
            existing.updatedAt = new Date();
            return deepClone(existing);
          }

          if (!options.upsert) return null;
          const inserted = {
            userId: filter.userId,
            shelfKey: filter.shelfKey,
            shelfTitle: "",
            status: "generating",
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          applyUpdate(inserted, update);
          docs.set(key, inserted);
          return deepClone(inserted);
        },
      };
    },
    async updateOne(filter, update) {
      const doc = [...docs.values()].find((item) => matchesFilter(item, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(doc, update);
      doc.updatedAt = new Date();
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

test("first opened shelf request generates and saves the shelf", async () => {
  const fakeModel = createFakeShelfModel();
  const shelfService = createGeneratedRecommendationShelfService(fakeModel);
  let generationCalls = 0;
  const buildRecommendations = async () => {
    generationCalls += 1;
    return engineResponse("First");
  };
  const buildCollections = createRecommendationCollectionBuilder({
    buildRecommendations,
    shelfService,
  });

  const result = await buildCollections(collectionInput());
  const saved = fakeModel.docs.get("user-cache-test:similar-to-your-favorites");

  assert.equal(generationCalls, 1);
  assert.equal(result.collections[0].books.length, 15);
  assert.equal(saved.status, "completed");
  assert.deepEqual(saved.response, result);
  assert.ok(saved.regenerateAfter instanceof Date);
});

test("reopening a fresh shelf returns the saved shelf without provider work", async () => {
  const savedResponse = shelfResponse("Saved");
  const fakeModel = createFakeShelfModel([
    {
      userId: "user-cache-test",
      shelfKey: "similar-to-your-favorites",
      shelfTitle: "Similar To Your Favorites",
      status: "completed",
      response: savedResponse,
      completedAt: new Date(),
      regenerateAfter: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    },
  ]);
  const shelfService = createGeneratedRecommendationShelfService(fakeModel);
  let generationCalls = 0;
  const buildCollections = createRecommendationCollectionBuilder({
    buildRecommendations: async () => {
      generationCalls += 1;
      return engineResponse("Unexpected");
    },
    shelfService,
  });

  const result = await buildCollections(collectionInput());

  assert.deepEqual(result, savedResponse);
  assert.equal(generationCalls, 0);
});

test("rapid concurrent shelf requests start only one generation", async () => {
  const fakeModel = createFakeShelfModel();
  const shelfService = createGeneratedRecommendationShelfService(fakeModel);
  let generationCalls = 0;
  const buildCollections = createRecommendationCollectionBuilder({
    buildRecommendations: async () => {
      generationCalls += 1;
      await sleep(80);
      return engineResponse("Concurrent");
    },
    shelfService,
  });

  const [first, second] = await Promise.all([
    buildCollections(collectionInput()),
    buildCollections(collectionInput()),
  ]);

  assert.equal(generationCalls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.collections[0].books.length, 15);
});

test("cached shelves remain unchanged for 3 days", async () => {
  const savedResponse = shelfResponse("ThreeDay");
  const fakeModel = createFakeShelfModel([
    {
      userId: "user-cache-test",
      shelfKey: "similar-to-your-favorites",
      shelfTitle: "Similar To Your Favorites",
      status: "completed",
      response: savedResponse,
      completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      regenerateAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  ]);
  const shelfService = createGeneratedRecommendationShelfService(fakeModel);

  const lookup = await shelfService.lookup(
    "user-cache-test",
    "similar-to-your-favorites",
  );

  assert.equal(lookup.state, "fresh");
  assert.deepEqual(lookup.response, savedResponse);
});

test("expired shelves return stale data and refresh only once", async () => {
  const oldResponse = shelfResponse("Old");
  const fakeModel = createFakeShelfModel([
    {
      userId: "user-cache-test",
      shelfKey: "similar-to-your-favorites",
      shelfTitle: "Similar To Your Favorites",
      status: "completed",
      response: oldResponse,
      completedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      regenerateAfter: new Date(Date.now() - 1000),
    },
  ]);
  const shelfService = createGeneratedRecommendationShelfService(fakeModel);
  let generationCalls = 0;
  const buildCollections = createRecommendationCollectionBuilder({
    buildRecommendations: async () => {
      generationCalls += 1;
      await sleep(40);
      return engineResponse("Fresh");
    },
    shelfService,
  });

  const [first, second] = await Promise.all([
    buildCollections(collectionInput()),
    buildCollections(collectionInput()),
  ]);
  await sleep(80);
  const saved = fakeModel.docs.get("user-cache-test:similar-to-your-favorites");

  assert.deepEqual(first, oldResponse);
  assert.deepEqual(second, oldResponse);
  assert.equal(generationCalls, 1);
  assert.equal(saved.response.collections[0].books[0].title, "Fresh Book 1");
});

test("stale generation locks can be reclaimed", async () => {
  const fakeModel = createFakeShelfModel([
    {
      userId: "user-cache-test",
      shelfKey: "similar-to-your-favorites",
      shelfTitle: "Similar To Your Favorites",
      status: "generating",
      generationId: "stale-owner",
      generationStartedAt: new Date(Date.now() - 11 * 60 * 1000),
    },
  ]);
  const shelfService = createGeneratedRecommendationShelfService(fakeModel);

  const claim = await shelfService.claimGeneration({
    userId: "user-cache-test",
    shelfKey: "similar-to-your-favorites",
    shelfTitle: "Similar To Your Favorites",
  });
  const saved = fakeModel.docs.get("user-cache-test:similar-to-your-favorites");

  assert.ok(claim);
  assert.notEqual(claim.generationId, "stale-owner");
  assert.equal(saved.generationId, claim.generationId);
});

test("failed generation attempts can be retried", async () => {
  const fakeModel = createFakeShelfModel([
    {
      userId: "user-cache-test",
      shelfKey: "similar-to-your-favorites",
      shelfTitle: "Similar To Your Favorites",
      status: "failed",
      lastError: "provider failed",
    },
  ]);
  const shelfService = createGeneratedRecommendationShelfService(fakeModel);

  const claim = await shelfService.claimGeneration({
    userId: "user-cache-test",
    shelfKey: "similar-to-your-favorites",
    shelfTitle: "Similar To Your Favorites",
  });
  const saved = fakeModel.docs.get("user-cache-test:similar-to-your-favorites");

  assert.ok(claim);
  assert.equal(saved.status, "generating");
  assert.equal(saved.generationId, claim.generationId);
});

test("failed refresh preserves the last successful shelf", async () => {
  const oldResponse = shelfResponse("Keep");
  const fakeModel = createFakeShelfModel([
    {
      userId: "user-cache-test",
      shelfKey: "similar-to-your-favorites",
      shelfTitle: "Similar To Your Favorites",
      status: "completed",
      response: oldResponse,
      completedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      regenerateAfter: new Date(Date.now() - 1000),
    },
  ]);
  const shelfService = createGeneratedRecommendationShelfService(fakeModel);
  const buildCollections = createRecommendationCollectionBuilder({
    buildRecommendations: async () => {
      throw new Error("refresh failed");
    },
    shelfService,
  });

  const result = await buildCollections(collectionInput());
  await sleep(40);
  const saved = fakeModel.docs.get("user-cache-test:similar-to-your-favorites");

  assert.deepEqual(result, oldResponse);
  assert.deepEqual(saved.response, oldResponse);
  assert.equal(saved.status, "completed");
  assert.equal(saved.lastError, "refresh failed");
  assert.equal(saved.refreshGenerationId, undefined);
});
