import assert from "node:assert/strict";
import test from "node:test";

process.env.GROQ_API_KEY = "test-groq-key";
process.env.MISTRAL_API_KEY = "test-mistral-key";

const { recommendationAIService, parseCandidateGroups } = await import(
  "../dist/services/recommendationAIService.js"
);
const { mistralChatJson } = await import("../dist/services/mistralAIClient.js");
const { recommendationScoringService } = await import(
  "../dist/services/recommendationScoringService.js"
);

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

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

test("primary candidate generation calls Mistral and includes Groq structure", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  let sentUserPrompt = "";
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url) === MISTRAL_URL) {
      mistralCalls += 1;
      sentUserPrompt = body.messages.find((message) => message.role === "user").content;
      return jsonResponse(providerResponse(candidatePayload));
    }
    if (String(url) === GROQ_URL) groqCalls += 1;
    throw new Error(`Unexpected URL ${url}`);
  };

  const groups = await recommendationAIService.generateCandidates({
    request: makeRequest("primary candidate provider split"),
    intent,
    profile,
    seedBook,
  });

  assert.equal(groups[0].candidates[0].title, "The Little Stranger");
  assert.equal(mistralCalls, 1);
  assert.equal(groqCalls, 0);
  assert.match(sentUserPrompt, /requestAnalysis/);
  assert.match(sentUserPrompt, /recommendationProfile/);
  assert.match(sentUserPrompt, /wistful gothic romance/);
  assert.match(sentUserPrompt, /Gothic Romance/);
});

test("fallback candidate generation calls Mistral and not Groq", async () => {
  let groqCalls = 0;
  let mistralCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === MISTRAL_URL) {
      mistralCalls += 1;
      return jsonResponse(providerResponse(candidatePayload));
    }
    if (String(url) === GROQ_URL) groqCalls += 1;
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
  assert.equal(mistralCalls, 1);
  assert.equal(groqCalls, 0);
});

test("candidate parser recovers code-fenced JSON", () => {
  const groups = parseCandidateGroups(`\`\`\`json\n${candidatePayload}\n\`\`\``);
  assert.equal(groups[0].candidates[0].author, "Sarah Waters");
});

test("malformed Mistral candidate output fails cleanly", async () => {
  globalThis.fetch = async () => jsonResponse(providerResponse("not json"));

  await assert.rejects(
    recommendationAIService.generateCandidates({
      request: makeRequest("malformed candidate provider split"),
      intent,
      profile,
      seedBook,
    }),
    /malformed JSON/,
  );
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

