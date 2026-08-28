import assert from "node:assert/strict";
import test from "node:test";

process.env.GROQ_API_KEY = "test-groq-key";

const { generateJournalAnalysis } = await import("../dist/services/generateJournalAnalysis.js");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function groqContent(content) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(content),
        },
      },
    ],
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function decodeRequests(calls) {
  return calls.map((call) => JSON.parse(call.body));
}

test("journal analysis runs three structured Groq requests concurrently and merges the existing schema", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const queued = [deferred(), deferred(), deferred()];

  global.fetch = async (_url, init) => {
    calls.push(init);
    return queued[calls.length - 1].promise;
  };

  try {
    const analysisPromise = generateJournalAnalysis([
      {
        title: "Morning",
        body: "I cleaned the kitchen, argued with Alex, then ended the day thinking about changing my routine.",
      },
    ]);

    await Promise.resolve();
    assert.equal(calls.length, 3);

    const requests = decodeRequests(calls);
    assert.deepEqual(
      requests.map((request) => request.max_completion_tokens),
      [180, 80, 1100],
    );
    assert.deepEqual(
      requests.map((request) => request.model),
      ["groq/compound", "groq/compound", "groq/compound"],
    );
    assert.deepEqual(
      requests.map((request) => request.response_format),
      [{ type: "json_object" }, { type: "json_object" }, { type: "json_object" }],
    );
    assert.equal(requests[0].messages[0].content.includes('"themes"'), true);
    assert.equal(requests[0].messages[0].content.includes('"mood"'), false);
    assert.equal(requests[0].messages[0].content.includes('"reflection"'), false);
    assert.equal(requests[1].messages[0].content.includes('"mood"'), true);
    assert.equal(requests[1].messages[0].content.includes('"themes"'), false);
    assert.equal(requests[1].messages[0].content.includes('"reflection"'), false);
    assert.equal(requests[2].messages[0].content.includes('"reflection"'), true);
    assert.equal(requests[2].messages[0].content.includes('"themes"'), false);
    assert.equal(requests[2].messages[0].content.includes('"mood"'), false);
    assert.equal(requests.every((request) => request.messages[1].content.includes("I cleaned the kitchen")), true);

    queued[1].resolve(jsonResponse(groqContent({ mood: "Reflective" })));
    queued[2].resolve(jsonResponse(groqContent({ reflection: "You moved through a practical morning, a tense moment with Alex, and a closing thought about changing your routine." })));
    queued[0].resolve(jsonResponse(groqContent({ themes: ["Routine", "Alex", "Household Tasks"] })));

    assert.deepEqual(await analysisPromise, {
      themes: ["Routine", "Alex", "Household Tasks"],
      mood: "Reflective",
      reflection: "You moved through a practical morning, a tense moment with Alex, and a closing thought about changing your routine.",
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("journal analysis rejects the whole result when one split request fails", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.messages[0].content.includes('"mood"')) {
      return jsonResponse({ error: { message: "failed" } }, 500);
    }
    if (request.messages[0].content.includes('"themes"')) {
      return jsonResponse(groqContent({ themes: ["Routine", "Alex"] }));
    }
    return jsonResponse(groqContent({ reflection: "You noticed a practical issue and a clear emotional turn." }));
  };

  try {
    await assert.rejects(
      generateJournalAnalysis([{ title: "Morning", body: "I argued with Alex and cleaned." }]),
      /Groq journal analysis failed for: mood/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("journal analysis keeps the JSON validation retry for each split request", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let themesAttempts = 0;

  global.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const request = calls.at(-1);

    if (request.messages[0].content.includes('"themes"')) {
      themesAttempts += 1;
      if (themesAttempts === 1) {
        return jsonResponse({ error: { code: "json_validate_failed" } }, 400);
      }
      assert.equal(request.response_format, undefined);
      return jsonResponse(groqContent({ themes: ["Routine", "Alex"] }));
    }

    if (request.messages[0].content.includes('"mood"')) {
      return jsonResponse(groqContent({ mood: "Reflective" }));
    }

    return jsonResponse(groqContent({ reflection: "You noticed a practical issue and a clear emotional turn." }));
  };

  try {
    const result = await generateJournalAnalysis([{ title: "Morning", body: "I argued with Alex and cleaned." }]);
    assert.deepEqual(result.themes, ["Routine", "Alex"]);
    assert.equal(result.mood, "Reflective");
    assert.equal(themesAttempts, 2);
    assert.equal(calls.length, 4);
  } finally {
    global.fetch = originalFetch;
  }
});
