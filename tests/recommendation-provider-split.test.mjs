import assert from "node:assert/strict";
import test from "node:test";

process.env.GROQ_API_KEY = "test-groq-key";
process.env.MISTRAL_API_KEY = "test-mistral-key";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENROUTER_MODEL = "test-openrouter-model";

const { recommendationAIService, parseCandidateGroups } = await import(
  "../dist/services/recommendationAIService.js"
);
const { buildRecommendationCollections } = await import(
  "../dist/services/recommendationCollectionService.js"
);
const { mistralChatJson } = await import("../dist/services/mistralAIClient.js");
const { openRouterChatJson } = await import("../dist/services/openRouterAIClient.js");
const { recommendationScoringService } = await import(
  "../dist/services/recommendationScoringService.js"
);
const { recommendationGroqModel, recommendationCollectionGroqModel } =
  await import("../dist/services/groqModelConfig.js");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPEN_LIBRARY_URL = "https://openlibrary.org/search.json";
const GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes";

test("recommendation Groq model is forced to compound", () => {
  const previousGroqModel = process.env.GROQ_MODEL;
  const previousRecommendationModel = process.env.RECOMMENDATION_GROQ_MODEL;
  const previousCollectionModel = process.env.RECOMMENDATION_COLLECTION_GROQ_MODEL;

  process.env.GROQ_MODEL = "llama-3.1-8b-instant";
  process.env.RECOMMENDATION_GROQ_MODEL = "llama-3.1-8b-instant";
  process.env.RECOMMENDATION_COLLECTION_GROQ_MODEL = "llama-3.1-8b-instant";

  try {
    assert.equal(recommendationGroqModel(), "groq/compound");
    assert.equal(recommendationCollectionGroqModel(), "groq/compound");
  } finally {
    if (previousGroqModel === undefined) {
      delete process.env.GROQ_MODEL;
    } else {
      process.env.GROQ_MODEL = previousGroqModel;
    }

    if (previousRecommendationModel === undefined) {
      delete process.env.RECOMMENDATION_GROQ_MODEL;
    } else {
      process.env.RECOMMENDATION_GROQ_MODEL = previousRecommendationModel;
    }

    if (previousCollectionModel === undefined) {
      delete process.env.RECOMMENDATION_COLLECTION_GROQ_MODEL;
    } else {
      process.env.RECOMMENDATION_COLLECTION_GROQ_MODEL = previousCollectionModel;
    }
  }
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function providerResponse(content) {
  return {
    choices: [
      {
        message: {
          content,
        },
      },
    ],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 22,
      total_tokens: 33,
    },
  };
}

function makeRequest(query) {
  return {
    query,
    surface: "route",
    desiredCount: 30,
    minVerifiedResults: 12,
    excludeBookKeys: ["already-read|writer"],
  };
}

const intent = {
  requestType: "mood",
  normalizedQuery: "wistful gothic romance",
  confidence: 0.91,
  entities: {
    mood: "wistful",
    genre: "gothic romance",
  },
};

const profile = {
  requestType: "mood",
  query: "wistful gothic romance",
  genre: "Gothic Romance",
  subgenres: ["Historical Gothic"],
  tone: "haunting",
  pacing: "slow burn",
  audience: "adult",
  romanceLevel: "medium",
  darknessLevel: "medium",
  keyTropes: ["haunted house"],
  themes: ["memory"],
  moods: ["wistful"],
  authors: ["Daphne du Maurier"],
  comparableBooks: [{ title: "Rebecca", author: "Daphne du Maurier" }],
};

const seedBook = {
  title: "Rebecca",
  author: "Daphne du Maurier",
  subjects: ["Gothic fiction"],
  description: "A young woman enters a house shadowed by the previous wife.",
};

const candidatePayload = JSON.stringify({
  groups: [
    {
      strategy: "closest_match",
      label: "Closest Match",
      books: [
        {
          title: "The Little Stranger",
          author: "Sarah Waters",
          summary: "A haunted country-house novel with restrained dread.",
          rationale: "Matches the Gothic atmosphere and slow-burn unease.",
          genres: ["Gothic"],
          moods: ["Haunting"],
          tropes: ["Haunted house"],
          themes: ["Memory"],
        },
      ],
    },
  ],
});

const recommendationStrategies = [
  "closest_match",
  "reader_safe",
  "hidden_gems",
  "recent_releases",
  "backlist",
  "adjacent_reads",
];

function strategyCandidatePayload(strategy, count = 10) {
  const offset = Math.max(0, recommendationStrategies.indexOf(strategy)) * 10;

  return JSON.stringify({
    strategy,
    label: strategy.replace(/_/g, " "),
    books: Array.from({ length: count }, (_, index) => ({
      title: `Collection Test Book ${offset + index + 1}`,
      author: `Collection Author ${offset + index + 1}`,
      summary: `A ${strategy} collection test candidate.`,
      rationale: "Matches the supplied reader profile.",
      genres: ["Fantasy Romance"],
      moods: ["Lush"],
      tropes: ["Slow burn"],
      themes: ["Power"],
    })),
  });
}

function parseCatalogBook(url) {
  const parsedUrl = new URL(String(url));
  const query = parsedUrl.searchParams.get("q") ?? "";
  const match = query.match(/Collection Test Book\s+(\d+)/i);
  const index = match ? Number(match[1]) : 1;

  return {
    index,
    title: `Collection Test Book ${index}`,
    author: `Collection Author ${index}`,
  };
}

test("request analysis calls Groq and not Mistral", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === GROQ_URL) {
      groqCalls += 1;
      return jsonResponse(providerResponse(JSON.stringify(intent)));
    }
    if (String(url) === MISTRAL_URL) mistralCalls += 1;
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await recommendationAIService.analyzeRequest(
    makeRequest("request analysis provider split"),
  );

  assert.equal(result.requestType, "mood");
  assert.equal(groqCalls, 1);
  assert.equal(mistralCalls, 0);
});

test("seed-book analysis calls Groq and not Mistral", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === GROQ_URL) {
      groqCalls += 1;
      return jsonResponse(providerResponse(JSON.stringify(profile)));
    }
    if (String(url) === MISTRAL_URL) mistralCalls += 1;
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await recommendationAIService.analyzeSeedBook({
    request: makeRequest("seed analysis provider split"),
    intent,
    seedBook,
  });

  assert.equal(result.genre, "Gothic Romance");
  assert.equal(groqCalls, 1);
  assert.equal(mistralCalls, 0);
});

test("shelf seed-profile Groq payload errors recover with intent profile", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === GROQ_URL) {
      groqCalls += 1;
      return jsonResponse(
        {
          error: {
            message: "Request Entity Too Large",
            type: "invalid_request_error",
            code: "request_too_large",
          },
        },
        413,
      );
    }
    if (String(url) === MISTRAL_URL) mistralCalls += 1;
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await recommendationAIService.analyzeSeedBook({
    request: {
      ...makeRequest("shelf profile payload recovery"),
      surface: "shelf",
      desiredCount: 15,
      minVerifiedResults: 8,
    },
    intent,
    seedBook,
  });

  assert.equal(result.requestType, intent.requestType);
  assert.equal(result.query, intent.normalizedQuery);
  assert.equal(result.genre, intent.entities.genre);
  assert.equal(groqCalls, 1);
  assert.equal(mistralCalls, 0);
});

test("primary candidate generation drafts with Mistral, finalizes with OpenRouter, and parses with Groq", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  let openRouterCalls = 0;
  const sentUserPrompts = [];
  const sentMistralPrompts = [];
  const sentGroqPrompts = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url) === MISTRAL_URL) {
      mistralCalls += 1;
      sentMistralPrompts.push(
        body.messages.find((message) => message.role === "user").content,
      );
      return jsonResponse(providerResponse("Mistral draft: The Little Stranger by Sarah Waters"));
    }
    if (String(url) === OPENROUTER_URL) {
      openRouterCalls += 1;
      sentUserPrompts.push(
        body.messages.find((message) => message.role === "user").content,
      );
      return jsonResponse(providerResponse(candidatePayload));
    }
    if (String(url) === GROQ_URL) {
      groqCalls += 1;
      sentGroqPrompts.push(
        body.messages.find((message) => message.role === "user").content,
      );
      return jsonResponse(providerResponse(candidatePayload));
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const groups = await recommendationAIService.generateCandidates({
    request: makeRequest("primary candidate provider split"),
    intent,
    profile,
    seedBook,
  });

  assert.equal(groups[0].candidates[0].title, "The Little Stranger");
  assert.equal(mistralCalls, 6);
  assert.equal(openRouterCalls, 6);
  assert.equal(groqCalls, 6);
  const sentUserPrompt = sentUserPrompts.join("\n");
  const sentMistralPrompt = sentMistralPrompts.join("\n");
  assert.match(sentUserPrompt, /requestAnalysis/);
  assert.match(sentUserPrompt, /recommendationProfile/);
  assert.match(sentUserPrompt, /tasteProfile/);
  assert.match(sentUserPrompt, /ratingSignals/);
  assert.match(sentUserPrompt, /readingPreferences/);
  assert.match(sentUserPrompt, /wistful gothic romance/);
  assert.doesNotMatch(sentUserPrompt, /"genre": "Gothic Romance"/);
  assert.doesNotMatch(sentUserPrompt, /"themes"/);
  assert.doesNotMatch(sentUserPrompt, /already-read\|writer/);
  assert.doesNotMatch(sentMistralPrompt, /already-read\|writer/);
  assert.match(sentUserPrompt, /Mistral draft candidate data/);
  assert.match(sentUserPrompt, /Strategy: closest_match/);
  assert.match(sentUserPrompt, /Strategy: adjacent_reads/);
  assert.match(sentGroqPrompts.join("\n"), /OpenRouter candidate data to parse/);
});

test("fallback candidate generation drafts with Mistral, finalizes with OpenRouter, and parses with Groq", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  let openRouterCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === MISTRAL_URL) {
      mistralCalls += 1;
      return jsonResponse(providerResponse("Mistral fallback draft"));
    }
    if (String(url) === OPENROUTER_URL) {
      openRouterCalls += 1;
      return jsonResponse(providerResponse(candidatePayload));
    }
    if (String(url) === GROQ_URL) {
      groqCalls += 1;
      return jsonResponse(providerResponse(candidatePayload));
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const groups = await recommendationAIService.generateFallbackCandidates({
    request: makeRequest("fallback candidate provider split"),
    intent,
    profile,
    seedBook,
    excludedTitles: ["Rebecca", "Mexican Gothic"],
  });

  assert.equal(groups[0].strategy, "closest_match");
  assert.equal(mistralCalls, 5);
  assert.equal(openRouterCalls, 5);
  assert.equal(groqCalls, 5);
});

test("opened recommendation collection returns 15 books when enough candidates verify", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  let openRouterCalls = 0;
  let openLibraryCalls = 0;
  let googleBooksCalls = 0;
  const openRouterPrompts = [];
  const mistralPrompts = [];

  globalThis.fetch = async (url, init) => {
    const urlText = String(url);

    if (urlText === GROQ_URL) {
      groqCalls += 1;
      const body = JSON.parse(init.body);
      const prompt =
        body.messages.find((message) => message.role === "user")?.content ?? "";
      if (/Groq final JSON parser job|OpenRouter candidate data to parse/.test(prompt)) {
        return jsonResponse(
          providerResponse(strategyCandidatePayload("closest_match", 15)),
        );
      }

      return jsonResponse(
        providerResponse(
          prompt.includes("Classify")
            ? JSON.stringify({
                ...intent,
                requestType: "genre",
                normalizedQuery: "collection thirty book provider split",
                entities: { genre: "Fantasy Romance" },
              })
            : JSON.stringify({
                ...profile,
                requestType: "genre",
                query: "collection thirty book provider split",
                genre: "Fantasy Romance",
              }),
        ),
      );
    }

    if (urlText === MISTRAL_URL) {
      mistralCalls += 1;
      const body = JSON.parse(init.body);
      const prompt =
        body.messages.find((message) => message.role === "user")?.content ?? "";
      mistralPrompts.push(prompt);
      return jsonResponse(providerResponse("Mistral collection draft"));
    }

    if (urlText === OPENROUTER_URL) {
      openRouterCalls += 1;
      const body = JSON.parse(init.body);
      const prompt =
        body.messages.find((message) => message.role === "user")?.content ?? "";
      openRouterPrompts.push(prompt);
      const strategy = prompt.match(/Strategy: ([a-z_]+)/)?.[1] ?? "closest_match";
      const count = /Return up to 15 books/.test(prompt) ? 15 : 10;
      return jsonResponse(providerResponse(strategyCandidatePayload(strategy, count)));
    }

    if (urlText.startsWith(OPEN_LIBRARY_URL)) {
      openLibraryCalls += 1;
      const book = parseCatalogBook(url);
      return jsonResponse({
        docs: [
          {
            title: book.title,
            author_name: [book.author],
            first_publish_year: 2000 + (book.index % 20),
            cover_i: 1000 + book.index,
            subject: ["Fantasy Romance", "Slow burn", "Power"],
          },
        ],
      });
    }

    if (urlText.startsWith(GOOGLE_BOOKS_URL)) {
      googleBooksCalls += 1;
      const book = parseCatalogBook(url);
      return jsonResponse({
        items: [
          {
            volumeInfo: {
              title: book.title,
              authors: [book.author],
              description: `Description for ${book.title}.`,
              publishedDate: `${2000 + (book.index % 20)}-01-01`,
              pageCount: 300 + book.index,
              categories: ["Fiction / Fantasy / Romance"],
              averageRating: 4.1,
              imageLinks: {
                thumbnail: `http://example.com/${book.index}.jpg`,
              },
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected URL ${urlText}`);
  };

  const response = await buildRecommendationCollections({
    collectionId: "similar-to-your-favorites",
    desiredCollections: 5,
    readerContext: {
      favoriteGenres: ["Fantasy Romance"],
      favoriteMoods: ["Lush"],
      favoriteTropes: ["slow burn"],
      favoriteAuthors: ["Provider Split Author"],
      highestRatedBooks: [
        {
          title: "Provider Split Favorite",
          author: "Provider Split Author",
          rating: 5,
        },
      ],
    },
    excludeBookKeys: ["owned-book|owned-author"],
  });

  const collection = response.collections[0];
  assert.equal(response.collections.length, 1);
  assert.equal(collection.id, "similar-to-your-favorites");
  assert.equal(collection.title, "Similar To Your Favorites");
  assert.equal(collection.bookCount, 15);
  assert.equal(collection.books.length, 15);
  assert.equal(new Set(collection.books.map((book) => book.title)).size, 15);
  assert.equal(groqCalls, 3);
  assert.equal(mistralCalls, 1);
  assert.equal(openRouterCalls, 1);
  const openedShelfPrompt = openRouterPrompts.join("\n");
  assert.match(openedShelfPrompt, /full opened collection shelf/i);
  assert.match(openedShelfPrompt, /"candidateCount": 40/);
  assert.match(mistralPrompts.join("\n"), /"candidateCount": 40/);
  assert.doesNotMatch(openedShelfPrompt, /owned-book\|owned-author/);
  assert.doesNotMatch(mistralPrompts.join("\n"), /owned-book\|owned-author/);
  assert.doesNotMatch(openRouterPrompts.join("\n"), /Strategy: reader_safe/);
  assert.doesNotMatch(openRouterPrompts.join("\n"), /Strategy: hidden_gems/);
  assert.ok(openLibraryCalls >= 15);
  assert.ok(googleBooksCalls >= 15);
});

test("candidate parser recovers code-fenced JSON", () => {
  const groups = parseCandidateGroups(`\`\`\`json\n${candidatePayload}\n\`\`\``);
  assert.equal(groups[0].candidates[0].author, "Sarah Waters");
});

test("candidate parser accepts a top-level groups array", () => {
  const payload = JSON.stringify(JSON.parse(candidatePayload).groups);
  const groups = parseCandidateGroups(payload);
  assert.equal(groups[0].candidates[0].title, "The Little Stranger");
});

test("candidate parser accepts a single strategy object", () => {
  const payload = JSON.stringify(JSON.parse(candidatePayload).groups[0]);
  const groups = parseCandidateGroups(payload);
  assert.equal(groups[0].strategy, "closest_match");
  assert.equal(groups[0].candidates[0].author, "Sarah Waters");
});

test("malformed OpenRouter candidate output is repaired by final Groq parse", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  let openRouterCalls = 0;
  const sentGroqPrompts = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url) === MISTRAL_URL) {
      mistralCalls += 1;
      return jsonResponse(providerResponse("Mistral draft"));
    }

    if (String(url) === OPENROUTER_URL) {
      openRouterCalls += 1;
      return jsonResponse(providerResponse("not json"));
    }

    if (String(url) === GROQ_URL) {
      groqCalls += 1;
      sentGroqPrompts.push(
        body.messages.find((message) => message.role === "user").content,
      );
      return jsonResponse(providerResponse(candidatePayload));
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const groups = await recommendationAIService.generateCandidates({
    request: makeRequest("malformed then valid candidate provider split"),
    intent,
    profile,
    seedBook,
  });

  assert.equal(groups[0].candidates[0].title, "The Little Stranger");
  assert.equal(mistralCalls, 6);
  assert.equal(openRouterCalls, 6);
  assert.equal(groqCalls, 6);
  assert.match(sentGroqPrompts.join("\n"), /OpenRouter candidate data to parse/);
  assert.match(sentGroqPrompts.join("\n"), /not json/);
});

test("final Groq payload errors recover from valid OpenRouter candidate JSON", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  let openRouterCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === MISTRAL_URL) {
      mistralCalls += 1;
      return jsonResponse(providerResponse("Mistral draft"));
    }

    if (String(url) === OPENROUTER_URL) {
      openRouterCalls += 1;
      return jsonResponse(providerResponse(candidatePayload));
    }

    if (String(url) === GROQ_URL) {
      groqCalls += 1;
      return jsonResponse(
        {
          error: {
            message: "Request Entity Too Large",
            type: "invalid_request_error",
            code: "request_too_large",
          },
        },
        413,
      );
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const groups = await recommendationAIService.generateCandidates({
    request: {
      ...makeRequest("final groq payload recovery"),
      surface: "shelf",
      desiredCount: 15,
      minVerifiedResults: 8,
    },
    intent,
    profile,
    seedBook,
  });

  assert.equal(groups[0].candidates[0].title, "The Little Stranger");
  assert.equal(mistralCalls, 1);
  assert.equal(openRouterCalls, 1);
  assert.equal(groqCalls, 1);
});

test("malformed Groq final candidate output fails cleanly", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  let openRouterCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === MISTRAL_URL) {
      mistralCalls += 1;
      return jsonResponse(providerResponse("Mistral draft"));
    }

    if (String(url) === OPENROUTER_URL) {
      openRouterCalls += 1;
      return jsonResponse(providerResponse("not json"));
    }

    if (String(url) === GROQ_URL) {
      groqCalls += 1;
      return jsonResponse(providerResponse("not json"));
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  await assert.rejects(
    recommendationAIService.generateCandidates({
      request: makeRequest("malformed candidate provider split"),
      intent,
      profile,
      seedBook,
    }),
    /malformed JSON/,
  );
  assert.equal(mistralCalls, 1);
  assert.equal(openRouterCalls, 1);
  assert.equal(groqCalls, 2);
});

test("transient Mistral errors use bounded retries", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ error: { message: "rate limited" } }, 429, {
        "retry-after": "0",
      });
    }

    return jsonResponse(providerResponse(candidatePayload));
  };

  const content = await mistralChatJson("system", "user", {
    stage: "test-transient",
    temperature: 0.1,
    maxTokens: 200,
  });

  assert.equal(JSON.parse(content).groups.length, 1);
  assert.equal(calls, 2);
});

test("Mistral auth and invalid-request errors are not retried", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ error: { message: "bad key" } }, 401);
  };

  await assert.rejects(
    mistralChatJson("system", "user", {
      stage: "test-auth",
      temperature: 0.1,
      maxTokens: 200,
    }),
    /HTTP 401/,
  );
  assert.equal(calls, 1);
});

test("transient OpenRouter errors use bounded retries", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ error: { message: "rate limited" } }, 429, {
        "retry-after": "0",
      });
    }

    return jsonResponse(providerResponse(candidatePayload));
  };

  const content = await openRouterChatJson("system", "user", {
    stage: "test-openrouter-transient",
    temperature: 0.1,
    maxTokens: 200,
  });

  assert.equal(JSON.parse(content).groups.length, 1);
  assert.equal(calls, 2);
});

test("OpenRouter auth and invalid-request errors are not retried", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ error: { message: "bad key" } }, 401);
  };

  await assert.rejects(
    openRouterChatJson("system", "user", {
      stage: "test-openrouter-auth",
      temperature: 0.1,
      maxTokens: 200,
    }),
    /HTTP 401/,
  );
  assert.equal(calls, 1);
});

test("request-analysis cache hit avoids provider calls", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(providerResponse(JSON.stringify(intent)));
  };

  const request = makeRequest("cache provider split");
  await recommendationAIService.analyzeRequest(request);
  await recommendationAIService.analyzeRequest(request);

  assert.equal(calls, 1);
});

test("deterministic scoring still runs after verification", () => {
  const recs = recommendationScoringService.scoreRecommendations({
    request: makeRequest("scoring provider split"),
    profile,
    seedBook,
    candidates: [
      {
        title: "The Little Stranger",
        author: "Sarah Waters",
        summary: "A haunted country-house novel with restrained dread.",
        tags: ["Gothic", "Haunted house"],
        source: "Google Books",
        catalogScore: 80,
        strategy: "closest_match",
        candidateRank: 0,
        genres: ["Gothic"],
        moods: ["Haunting"],
        tropes: ["Haunted house"],
        themes: ["Memory"],
      },
    ],
  });

  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, "The Little Stranger");
  assert.ok(recs[0].finalScore > 0);
});
