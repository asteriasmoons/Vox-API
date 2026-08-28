const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "groq/compound";
const RESPONSE_FORMAT = { type: "json_object" };
const encoder = new TextEncoder();
const GROQ_TIMEOUT_MS = 60_000;
const GROQ_RATE_LIMIT_RETRIES = 1;
const ANALYSIS_PARTS = {
  themes: { maxCompletionTokens: 180 },
  mood: { maxCompletionTokens: 80 },
  reflection: { maxCompletionTokens: 1100 },
} as const;

export interface JournalAnalysisResult {
  themes: string[];
  mood: string;
  reflection: string;
}

interface EntryInput {
  title: string;
  body: string;
}

interface GroqRequestBody {
  model: string;
  temperature: number;
  max_completion_tokens: number;
  response_format?: unknown;
  messages: { role: "system" | "user"; content: string }[];
}

type AnalysisPart = keyof typeof ANALYSIS_PARTS;

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function longestBase64LikeRun(value: string): number {
  const runs = value.match(/[A-Za-z0-9+/=]{200,}/g) ?? [];
  return runs.reduce((max, run) => Math.max(max, run.length), 0);
}

function logRequestDiagnostics(part: AnalysisPart, body: GroqRequestBody, serializedBody: string): void {
  const record = body as unknown as Record<string, unknown>;
  console.log("[analyze] Groq request diagnostics:", {
    part,
    bodyBytes: byteLength(serializedBody),
    bodyChars: serializedBody.length,
    topLevelKeys: Object.keys(record),
    model: body.model,
    temperature: body.temperature,
    maxTokens: record.max_tokens ?? null,
    maxCompletionTokens: record.max_completion_tokens ?? null,
    responseFormat: body.response_format,
    messageCount: body.messages.length,
    messages: body.messages.map((message, index) => ({
      index,
      role: message.role,
      chars: message.content.length,
      bytes: byteLength(message.content),
      longestBase64LikeRun: longestBase64LikeRun(message.content),
      hasDataUrl: /data:[^;]+;base64,/i.test(message.content),
    })),
    hasAttachmentsField: Object.prototype.hasOwnProperty.call(record, "attachments"),
    hasDocumentsField: Object.prototype.hasOwnProperty.call(record, "documents"),
    hasHistoryField: Object.prototype.hasOwnProperty.call(record, "history"),
    hasToolsField: Object.prototype.hasOwnProperty.call(record, "tools"),
  });
}

function logEntryDiagnostics(entries: EntryInput[], entryText: string): void {
  const bodyCounts = new Map<string, number>();
  for (const entry of entries) {
    bodyCounts.set(entry.body, (bodyCounts.get(entry.body) ?? 0) + 1);
  }

  console.log("[analyze] Journal entry diagnostics:", {
    entryCount: entries.length,
    entryTextChars: entryText.length,
    entryTextBytes: byteLength(entryText),
    duplicateBodyGroups: Array.from(bodyCounts.values()).filter((count) => count > 1).length,
    entries: entries.map((entry, index) => ({
      index,
      titleChars: entry.title.length,
      titleBytes: byteLength(entry.title),
      bodyChars: entry.body.length,
      bodyBytes: byteLength(entry.body),
      trimmedBodyChars: entry.body.trim().length,
      trimmedBodyBytes: byteLength(entry.body.trim()),
      longestBase64LikeRun: longestBase64LikeRun(entry.body),
      hasDataUrl: /data:[^;]+;base64,/i.test(entry.body),
    })),
  });
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const content = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!content) return null;

  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function isJsonValidationFailure(status: number, body: string): boolean {
  return status === 400 && body.includes("json_validate_failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function groqRetryDelayMs(resp: Response, body: string): number {
  const retryAfter = resp.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(Math.ceil(seconds * 1000), 55_000);
    }
  }

  const match = body.match(/try again in ([\d.]+)s/i);
  if (match?.[1]) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(Math.ceil(seconds * 1000), 55_000);
    }
  }

  return 5_000;
}

async function postGroq(
  apiKey: string,
  body: GroqRequestBody,
  part: AnalysisPart,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const serializedBody = JSON.stringify(body);
  logRequestDiagnostics(part, body, serializedBody);

  try {
    return await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: serializedBody,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Groq ${part} request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanString(item)).filter(Boolean)
    : [];
}

function themesFromParsed(parsed: Record<string, unknown>): Pick<JournalAnalysisResult, "themes"> {
  const themes = cleanStringArray(parsed.themes);

  console.log("[analyze] themes:", themes);

  if (themes.length === 0) {
    throw new Error("Groq returned no journal themes");
  }

  return { themes };
}

function moodFromParsed(parsed: Record<string, unknown>): Pick<JournalAnalysisResult, "mood"> {
  const mood = cleanString(parsed.mood);

  console.log("[analyze] mood:", mood);

  if (!mood) {
    throw new Error("Groq returned no journal mood");
  }

  return { mood };
}

function reflectionFromParsed(parsed: Record<string, unknown>): Pick<JournalAnalysisResult, "reflection"> {
  const reflection = cleanString(parsed.reflection);

  console.log("[analyze] reflection length:", reflection.length);

  if (!reflection) {
    throw new Error("Groq returned no journal reflection");
  }

  return { reflection };
}

async function parseGroqJsonResponse(resp: Response, part: AnalysisPart): Promise<Record<string, unknown>> {
  const json: any = await resp.json();
  const raw = cleanString(json?.choices?.[0]?.message?.content);
  console.log(`[analyze] Groq ${part} raw response:`, raw);

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    console.error(`[analyze] ${part} JSON parse error: unable to extract JSON object`);
    throw new Error(`Failed to parse Groq ${part} JSON response: ${raw}`);
  }

  console.log(`[analyze] ${part} parsed:`, JSON.stringify(parsed));
  return parsed;
}

function valueForPart(part: AnalysisPart, parsed: Record<string, unknown>): Partial<JournalAnalysisResult> {
  switch (part) {
    case "themes":
      return themesFromParsed(parsed);
    case "mood":
      return moodFromParsed(parsed);
    case "reflection":
      return reflectionFromParsed(parsed);
  }
}

async function runAnalysisPart(
  apiKey: string,
  part: AnalysisPart,
  body: GroqRequestBody,
): Promise<Partial<JournalAnalysisResult>> {
  for (let attempt = 0; attempt <= GROQ_RATE_LIMIT_RETRIES; attempt += 1) {
    console.log(`[analyze] Sending ${part} request to Groq...`);

    let resp = await postGroq(apiKey, body, part, GROQ_TIMEOUT_MS);

    console.log(`[analyze] Groq ${part} status:`, resp.status);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`[analyze] Groq ${part} error body:`, text);
      if (isJsonValidationFailure(resp.status, text)) {
        console.warn(`[analyze] Retrying Groq ${part} without response_format after JSON validation failure`);
        const retryBody: GroqRequestBody = { ...body };
        delete retryBody.response_format;
        resp = await postGroq(apiKey, retryBody, part, GROQ_TIMEOUT_MS);

        if (resp.ok) {
          return valueForPart(part, await parseGroqJsonResponse(resp, part));
        }

        const retryText = await resp.text().catch(() => "");
        console.error(`[analyze] Groq ${part} retry error body:`, retryText);
        throw new Error(`Groq ${part} error ${resp.status}: ${retryText}`);
      }

      if (resp.status === 429 && attempt < GROQ_RATE_LIMIT_RETRIES) {
        const delayMs = groqRetryDelayMs(resp, text);
        console.warn(`[analyze] Retrying Groq ${part} after rate limit in ${delayMs}ms`);
        await sleep(delayMs);
        continue;
      }

      throw new Error(`Groq ${part} error ${resp.status}: ${text}`);
    }

    return valueForPart(part, await parseGroqJsonResponse(resp, part));
  }

  throw new Error(`Groq ${part} failed after retry`);
}

function buildGroqRequest(
  part: AnalysisPart,
  systemPrompt: string,
  userPrompt: string,
): GroqRequestBody {
  return {
    model: MODEL,
    temperature: 0.1,
    max_completion_tokens: ANALYSIS_PARTS[part].maxCompletionTokens,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
}

function ensureCompleteAnalysis(
  result: Partial<JournalAnalysisResult>,
): JournalAnalysisResult {
  if (!Array.isArray(result.themes) || result.themes.length === 0 || !result.mood || !result.reflection) {
    throw new Error("Groq returned incomplete analysis fields");
  }

  return {
    themes: result.themes,
    mood: result.mood,
    reflection: result.reflection,
  };
}

function failedPartNames(results: PromiseSettledResult<unknown>[]): string[] {
  return (Object.keys(ANALYSIS_PARTS) as AnalysisPart[]).filter(
    (_part, index) => results[index]?.status === "rejected",
  );
}

export async function generateJournalAnalysis(
  entries: EntryInput[],
): Promise<JournalAnalysisResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const entryText = entries
    .map((e) => `Entry: "${e.title}"\n${e.body.trim()}`)
    .join("\n\n---\n\n");
  logEntryDiagnostics(entries, entryText);

  const fieldRequests: Array<{
    part: AnalysisPart;
    body: GroqRequestBody;
  }> = [
    {
      part: "themes",
      body: buildGroqRequest(
        "themes",
        `You analyze private journal entries for a wellness app called Lunixia.

Accuracy matters more than depth. Relevance matters more than cleverness. Ordinary things are allowed to stay ordinary. Respond intelligently to what is actually present instead of forcing hidden meaning or trying to sound profound.

Never assume a named person's relationship to the user. If the journal names someone but does not explicitly identify the relationship, use that person's name only. Do not invent labels such as friend, partner, spouse, family member, coworker, or similar relationship terms. Theme tags must follow the same rule: prefer a grounded label such as "Jordan's mood" over an invented relationship label such as "friend's attitude."

Stay completely grounded in what was actually written. Never invent emotions, motivations, beliefs, personality traits, trauma, attachment styles, diagnoses, symbolism, or personal growth that the journal does not support. Never upgrade an inference into a fact.

Notice patterns, shifts, contradictions, repeated ideas, or meaningful connections only when they are clear enough to be useful. Do not stretch minor details into larger conclusions, but do not omit major parts of the entry just because they are ordinary.

CRITICAL JSON FORMAT RULES:
- Return only valid JSON.
- Return a JSON object with exactly this key: "themes".
- Every string value must be wrapped in double quotes.
- Do not write line breaks outside JSON string values.

JSON field requirements:

themes
- 2-4 concise theme tags
- 1-3 words each
- scannable labels
- emotionally neutral
- never deficit-based`,
        `Read this journal entry fully from beginning to end before responding. Identify only the concise theme tags that belong in the Daily Analysis. Stay grounded in what is actually there. Do not invent relationship labels for named people.

${entryText}`,
      ),
    },
    {
      part: "mood",
      body: buildGroqRequest(
        "mood",
        `You analyze private journal entries for a wellness app called Lunixia.

Accuracy matters more than depth. Relevance matters more than cleverness. Ordinary things are allowed to stay ordinary. Respond intelligently to what is actually present instead of forcing hidden meaning or trying to sound profound.

Stay completely grounded in what was actually written. Never invent emotions, motivations, beliefs, personality traits, trauma, attachment styles, diagnoses, symbolism, or personal growth that the journal does not support. Never upgrade an inference into a fact.

Do not intensify emotions beyond the user's wording. If they write boredom, do not call it hopelessness. If they write tiredness, do not call it exhaustion. If they write uncertainty, do not call it crisis.

CRITICAL JSON FORMAT RULES:
- Return only valid JSON.
- Return a JSON object with exactly this key: "mood".
- Every string value must be wrapped in double quotes.
- Do not write line breaks outside JSON string values.

JSON field requirements:

mood
- 1-3 words
- emotionally accurate
- never clinical, insulting, or judgmental`,
        `Read this journal entry fully from beginning to end before responding. Identify only the short mood label that belongs in the Daily Analysis. Stay emotionally accurate without intensifying beyond the user's wording.

${entryText}`,
      ),
    },
    {
      part: "reflection",
      body: buildGroqRequest(
        "reflection",
        `You analyze private journal entries for a wellness app called Lunixia.

Write like an intelligent friend who read the whole entry carefully and has a few perceptive observations. Accuracy matters more than depth. Relevance matters more than cleverness. Ordinary things are allowed to stay ordinary. Respond intelligently to what is actually present instead of forcing hidden meaning or trying to sound profound.

Do not produce a recap of the journal, but do acknowledge the entire entry from beginning through the closing thought so the user feels that nothing important was skipped. Acknowledge all major subjects, practical events, emotional turns, decisions, questions, and conclusions without turning each one into a separate mini-analysis. Do not compliment, reassure, encourage, advise, coach, or therapize. Do not write like a teacher, psychologist, clinical analyst, literary critic, or motivational speaker.

Always write directly to the user using "you." Never refer to the user in the third person.

Never assume a named person's relationship to the user. If the journal names someone but does not explicitly identify the relationship, use that person's name only. Do not invent labels such as friend, partner, spouse, family member, coworker, or similar relationship terms.

Stay completely grounded in what was actually written. Never invent emotions, motivations, beliefs, personality traits, trauma, attachment styles, diagnoses, symbolism, or personal growth that the journal does not support. Never upgrade an inference into a fact.

Only infer when the connection is genuinely supported by the entry. Do not connect unrelated subjects just to make the analysis feel deeper. Do not treat practical events as symbols unless the user clearly framed them that way. A dog accident can simply be a dog accident. A chore can simply be a chore.

Notice patterns, shifts, contradictions, repeated ideas, or meaningful connections only when they are clear enough to be useful. Cover the full entry even when only a few parts invite deeper analysis: some parts can simply be acknowledged accurately. Do not stretch minor details into larger conclusions, but do not omit major parts of the entry just because they are ordinary.

Use normal conversational language. Sound like a smart friend, not a report. Avoid academic or literary-analysis words such as juxtaposition, polarity, underscores, symbolizes, externalizing, dichotomy, tangible versus intangible, or similar language unless the user actually writes that way.

Prefer precise observations like:
"You were irritated by this, but it did not dominate the rest of the entry."
"You moved from a practical problem into a broader thought about joy."
"The thing you kept returning to was..."

Avoid vague depth-signaling phrases such as:
"This raises the possibility that..."
"It almost reads as though..."
"This may represent something larger..."
"There is a quiet tension between..."
unless the journal provides unusually strong evidence for them.

Do not intensify emotions beyond the user's wording. If they write boredom, do not call it hopelessness. If they write tiredness, do not call it exhaustion. If they write uncertainty, do not call it crisis.

Do not repeat the same observation in different words. Once a point is made, move on.

Length should match the substance of the entry. For a substantive entry, aim for 250-450 words total so there is enough room to acknowledge the whole entry without rushing. One or two paragraphs are usually enough; use three when the entry contains several distinct subjects or turns. Very short entries may be shorter, but do not compress a full entry so aggressively that major subjects or the closing thought disappear.

The ideal response should leave the user feeling accurately understood and maybe noticing one or two real patterns they had not explicitly named. It should never feel like the model is hunting for a thesis.

CRITICAL JSON FORMAT RULES:
- Return only valid JSON.
- Return a JSON object with exactly this key: "reflection".
- Every string value must be wrapped in double quotes.
- The reflection value must be one JSON string.
- Use escaped newline characters \n only when separating paragraphs.
- Do not include literal line breaks inside the reflection string.
- Do not write line breaks outside JSON string values.

JSON field requirements:

reflection
- one natural conversational analysis
- usually 250-450 words for a substantive entry; shorter only when the journal itself is very short
- usually 1-2 paragraphs; up to 3 when the entry contains several distinct subjects or turns
- acknowledges the entire entry from its opening practical details through its closing thought
- no headings, labels, bullets, or numbered parts
- grounded in the user's actual writing
- notices only clear, useful patterns or connections
- ordinary details may remain ordinary while still being acknowledged
- no forced symbolism, hidden meanings, invented psychological explanations, or invented relationship labels
- sounds like an intelligent friend, not an analyst, report, book report, or therapist`,
        `Here is my journal entry. Read it fully from beginning to end before responding. Give me a grounded, conversational analysis of what is actually there. Acknowledge every major subject, practical event, emotional turn, decision, question, and closing thought, even when some of those details are ordinary and do not need deeper interpretation. Notice clear patterns or connections if they genuinely exist, but do not hunt for hidden meaning, symbolism, or psychological explanations. Never assume how any named person is related to me unless the journal explicitly says so; otherwise use the person's name only. Do not recap the entry, and do not praise, reassure, encourage, advise, or therapize. Be thorough enough that the whole entry feels read, but do not inflate minor details just to sound insightful.

${entryText}`,
      ),
    },
  ];

  const results = await Promise.allSettled(
    fieldRequests.map(({ part, body }) => runAnalysisPart(apiKey, part, body)),
  );
  const failedParts = failedPartNames(results);

  if (failedParts.length > 0) {
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`[analyze] ${fieldRequests[index]?.part} request failed:`, result.reason);
      }
    });
    throw new Error(`Groq journal analysis failed for: ${failedParts.join(", ")}`);
  }

  const merged = results.reduce<Partial<JournalAnalysisResult>>((acc, result) => {
    if (result.status === "fulfilled") {
      return { ...acc, ...result.value };
    }
    return acc;
  }, {});

  const analysis = ensureCompleteAnalysis(merged);
  console.log("[analyze] merged analysis:", {
    themes: analysis.themes,
    mood: analysis.mood,
    reflectionLength: analysis.reflection.length,
  });

  return analysis;
}
