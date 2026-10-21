import assert from "node:assert/strict";
import test from "node:test";

process.env.GROQ_API_KEY = "test-groq-key";

const { generateJournalReflectionQuestions } = await import(
  "../dist/services/generateJournalReflection.js"
);

function jsonResponse(content) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

test("older reflection dates are sent to the model and current-tense questions are repaired", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const invalidQuestions = {
    questions: [
      "What is making it difficult to return to your morning routine right now?",
      "When you wrote this entry, what made the unfinished work feel important?",
      "In this entry, what part of the unexpected discovery stood out most?",
      "You mentioned feeling relieved. How do you view that relief today?",
    ],
  };
  const repairedQuestions = {
    questions: [
      "When you wrote this entry, what made returning to your morning routine feel difficult?",
      "Looking back at the unfinished work you described, what part feels most important to examine today?",
      "In this entry, what part of the unexpected discovery stood out most?",
      "You mentioned feeling relieved. How do you view that relief today?",
    ],
  };

  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return jsonResponse(requests.length === 1 ? invalidQuestions : repairedQuestions);
  };

  try {
    const questions = await generateJournalReflectionQuestions({
      entryTitle: "Morning",
      entryContent: "I wanted to return to my morning routine. I found unfinished work and felt relieved by an unexpected discovery.",
      entryDate: "2025-02-03T15:00:00.000Z",
      reflectionDate: "2026-10-21T15:00:00.000Z",
      timeZone: "America/Chicago",
    });

    assert.deepEqual(questions, repairedQuestions.questions);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].model, "openai/gpt-oss-120b");
    assert.equal(requests[0].temperature, 0.05);
    assert.match(requests[0].messages[1].content, /Entry written: February 3, 2025/);
    assert.match(requests[0].messages[1].content, /Reflection started: October 21, 2026/);
    assert.match(requests[0].messages[1].content, /OLDER, HISTORICAL entry/);
    assert.match(requests[1].messages[1].content, /previous question set was rejected/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("same-day reflections retain current framing without a repair request", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const questions = [
    "What feels hardest about returning to your morning routine today?",
    "What part of the unfinished work matters most to you?",
    "What made the unexpected discovery feel relieving?",
    "What are you uncertain about after making that discovery?",
  ];

  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return jsonResponse({ questions });
  };

  try {
    const result = await generateJournalReflectionQuestions({
      entryTitle: "Morning",
      entryContent: "I wanted to return to my morning routine. I found unfinished work and felt relieved by an unexpected discovery.",
      entryDate: "2026-10-21T14:30:00.000Z",
      reflectionDate: "2026-10-21T15:00:00.000Z",
      timeZone: "America/Chicago",
    });

    assert.deepEqual(result, questions);
    assert.equal(requests.length, 1);
    assert.match(requests[0].messages[1].content, /SAME-DAY reflection/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reflection generation refuses to guess when either date is invalid", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;

  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("The provider should not be called");
  };

  try {
    await assert.rejects(
      generateJournalReflectionQuestions({
        entryTitle: "Morning",
        entryContent: "I wanted to return to my morning routine.",
        entryDate: "",
        reflectionDate: "2026-10-21T15:00:00.000Z",
        timeZone: "America/Chicago",
      }),
      /Valid entry and reflection dates are required/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});
