const GROQ_URL = "https://api.cerebras.ai/v1/chat/completions";
const MODEL = "gpt-oss-120b";
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "journal_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        themes: {
          type: "array",
          items: { type: "string" },
        },
        mood: { type: "string" },
        reflection: { type: "string" },
      },
      required: ["themes", "mood", "reflection"],
      additionalProperties: false,
    },
  },
};

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
  reasoning_effort?: "low" | "medium" | "high";
  response_format?: unknown;
  messages: { role: "system" | "user"; content: string }[];
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

async function postGroq(
  apiKey: string,
  body: GroqRequestBody,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Groq request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function journalAnalysisFromParsed(parsed: Record<string, unknown>): JournalAnalysisResult {
  const themes = Array.isArray(parsed.themes)
    ? parsed.themes.map((t: any) => String(t).trim()).filter(Boolean)
    : [];
  const mood = String(parsed.mood || "").trim();
  const reflection = String(parsed.reflection || "").trim();

  console.log("[analyze] themes:", themes, "mood:", mood, "reflection length:", reflection.length);

  if (!mood || !reflection || themes.length === 0) {
    throw new Error("Groq returned incomplete analysis fields");
  }

  return { themes, mood, reflection };
}

export async function generateJournalAnalysis(
  entries: EntryInput[],
): Promise<JournalAnalysisResult> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error("Missing CEREBRAS_API_KEY");

  const entryText = entries
    .map((e) => `Entry: "${e.title}"\n${e.body.trim()}`)
    .join("\n\n---\n\n");

  const body: GroqRequestBody = {
    model: MODEL,
    temperature: 0.25,
    max_completion_tokens: 5500,
    reasoning_effort: "low",
    response_format: RESPONSE_FORMAT,
    messages: [
      {
        role: "system",
        content: `You analyze private journal entries for a wellness app called Lunixia.

Write like an intelligent friend who read the whole entry carefully and has a few perceptive observations. Accuracy matters more than depth. Relevance matters more than cleverness. Ordinary things are allowed to stay ordinary. Respond intelligently to what is actually present instead of forcing hidden meaning or trying to sound profound.

Do not produce a recap of the journal, but do acknowledge the entire entry from beginning through the closing thought so the user feels that nothing important was skipped. Acknowledge all major subjects, practical events, emotional turns, decisions, questions, and conclusions without turning each one into a separate mini-analysis. Do not compliment, reassure, encourage, advise, coach, or therapize. Do not write like a teacher, psychologist, clinical analyst, literary critic, or motivational speaker.

Always write directly to the user using "you." Never refer to the user in the third person.

Never assume a named person's relationship to the user. If the journal names someone but does not explicitly identify the relationship, use that person's name only. Do not invent labels such as friend, partner, spouse, family member, coworker, or similar relationship terms. Theme tags must follow the same rule: prefer a grounded label such as "Jordan's mood" over an invented relationship label such as "friend's attitude."

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
- Return a JSON object with exactly these keys: "themes", "mood", "reflection".
- Every string value must be wrapped in double quotes.
- The reflection value must be one JSON string.
- Use escaped newline characters \n only when separating paragraphs.
- Do not include literal line breaks inside the reflection string.
- Do not write line breaks outside JSON string values.

JSON field requirements:

themes
- 2-4 concise theme tags
- 1-3 words each
- scannable labels
- emotionally neutral
- never deficit-based

mood
- 1-3 words
- emotionally accurate
- never clinical, insulting, or judgmental

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
      },
      {
        role: "user",
        content: `Here is my journal entry. Read it fully from beginning to end before responding. Give me a grounded, conversational analysis of what is actually there. Acknowledge every major subject, practical event, emotional turn, decision, question, and closing thought, even when some of those details are ordinary and do not need deeper interpretation. Notice clear patterns or connections if they genuinely exist, but do not hunt for hidden meaning, symbolism, or psychological explanations. Never assume how any named person is related to me unless the journal explicitly says so; otherwise use the person's name only. Do not recap the entry, and do not praise, reassure, encourage, advise, or therapize. Be thorough enough that the whole entry feels read, but do not inflate minor details just to sound insightful.

${entryText}`,
      },
    ],
  };

  console.log("[analyze] Sending request to Groq...");

  let resp = await postGroq(apiKey, body, 60_000);

  console.log("[analyze] Groq status:", resp.status);

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("[analyze] Groq error body:", text);
    if (isJsonValidationFailure(resp.status, text)) {
      console.warn("[analyze] Retrying Groq without response_format after JSON validation failure");
      const retryBody: GroqRequestBody = { ...body };
      delete retryBody.response_format;
      resp = await postGroq(apiKey, retryBody, 60_000);

      if (resp.ok) {
        const json: any = await resp.json();
        const raw = String(json?.choices?.[0]?.message?.content || "").trim();
        console.log("[analyze] Groq raw response:", raw);

        const parsed = parseJsonObject(raw);
        if (!parsed) {
          console.error("[analyze] JSON parse error: unable to extract JSON object");
          throw new Error(`Failed to parse Groq JSON response: ${raw}`);
        }

        console.log("[analyze] Parsed:", JSON.stringify(parsed));
        return journalAnalysisFromParsed(parsed);
      }

      const retryText = await resp.text().catch(() => "");
      console.error("[analyze] Groq retry error body:", retryText);
      throw new Error(`Groq error ${resp.status}: ${retryText}`);
    }
    throw new Error(`Groq error ${resp.status}: ${text}`);
  }

  const json: any = await resp.json();
  const raw = String(json?.choices?.[0]?.message?.content || "").trim();
  console.log("[analyze] Groq raw response:", raw);

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    console.error("[analyze] JSON parse error: unable to extract JSON object");
    throw new Error(`Failed to parse Groq JSON response: ${raw}`);
  }

  console.log("[analyze] Parsed:", JSON.stringify(parsed));

  return journalAnalysisFromParsed(parsed);
}
