const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";

const RESPONSE_FORMAT = { type: "json_object" };

export interface JournalAnalysisResult {
  themes: string[];
  mood: string;
  reflection: string;
}

interface EntryInput {
  title: string;
  body: string;
}

interface OpenRouterRequestBody {
  model: string;
  temperature: number;
  max_tokens: number;
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

async function postOpenRouter(
  apiKey: string,
  body: OpenRouterRequestBody,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(OPENROUTER_URL, {
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
      throw new Error(
        `OpenRouter request timed out after ${timeoutMs / 1000}s`,
      );
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function journalAnalysisFromParsed(
  parsed: Record<string, unknown>,
): JournalAnalysisResult {
  const themes = Array.isArray(parsed.themes)
    ? parsed.themes.map((t: any) => String(t).trim()).filter(Boolean)
    : [];

  const mood = String(parsed.mood || "").trim();
  const reflection = String(parsed.reflection || "").trim();

  console.log(
    "[analyze] themes:",
    themes,
    "mood:",
    mood,
    "reflection length:",
    reflection.length,
  );

  if (!mood || !reflection || themes.length === 0) {
    throw new Error("OpenRouter returned incomplete analysis fields");
  }

  return {
    themes,
    mood,
    reflection,
  };
}

export async function generateJournalAnalysis(
  entries: EntryInput[],
): Promise<JournalAnalysisResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  const entryText = entries
    .map((e) => `Entry: "${e.title}"\n${e.body.trim()}`)
    .join("\n\n---\n\n");

  const body: OpenRouterRequestBody = {
    model: MODEL,
    temperature: 0.25,
    max_tokens: 1200,
    response_format: RESPONSE_FORMAT,

    messages: [
      {
        role: "system",
        content: `You analyze private journal entries for the wellness app Lunixia.

Write directly to the user as an intelligent friend who carefully read the entire entry. Use "you," never third person. Be perceptive, conversational, precise, and grounded. Accuracy and relevance matter more than sounding profound.

Analyze what is actually written. Do not recap the journal, but acknowledge every major subject, practical event, emotional turn, decision, question, and closing thought so the full entry feels read. Ordinary details may remain ordinary. Go deeper only when the entry clearly supports it.

Notice meaningful patterns, shifts, contradictions, repeated ideas, or connections when they are genuinely present. Never force unrelated subjects together or treat practical events as symbols without clear support.

Do not invent or exaggerate:
- emotions
- motivations
- beliefs
- personality traits
- psychological explanations
- diagnoses
- trauma
- symbolism
- personal growth
- relationship labels

Never turn an inference into a fact. Match emotional intensity to the user's actual wording.

If a person is named but their relationship to the user is not explicitly stated, use only their name. Never invent labels such as friend, partner, spouse, family member, or coworker. Theme tags follow the same rule.

Do not compliment, praise, reassure, encourage, advise, coach, therapize, or tell the user what they should do.

Do not sound clinical, academic, literary, motivational, or like a report. Avoid abstract depth-signaling language when a direct observation works better.

Do not repeat an observation in different words.

For a substantive entry, the reflection should usually be 250-450 words and 1-2 natural paragraphs. Use up to 3 paragraphs when several distinct subjects or shifts require it. Short entries may receive shorter reflections.

Return only the structured JSON requested by the response schema.

Field requirements:

themes:
- 2-4 concise theme tags
- 1-3 words each
- grounded in the entry
- scannable and emotionally neutral
- never deficit-based

mood:
- 1-3 words
- accurately reflects the overall emotional tone
- never clinical, insulting, or judgmental

reflection:
- one natural conversational analysis
- normally 250-450 words for a substantive entry
- acknowledge the entry from its opening details through its closing thought
- no headings, labels, bullets, or numbered sections
- include only supported observations and connections
- no forced symbolism or hidden meanings
- no invented relationships or psychological explanations
- sound like an intelligent friend who genuinely read the whole thing`,
      },

      {
        role: "user",
        content: `Read this journal entry completely before analyzing it.

Give me one grounded conversational analysis that accounts for the whole entry. Include the important practical details and emotional turns, even when they do not require deeper interpretation. Notice meaningful patterns or connections only when they are clearly supported.

Do not recap, praise, reassure, advise, therapize, invent relationships, or search for hidden meaning.

${entryText}`,
      },
    ],
  };

  console.log("[analyze] Sending request to OpenRouter...");

  const resp = await postOpenRouter(apiKey, body, 60_000);

  console.log("[analyze] OpenRouter status:", resp.status);

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");

    console.error("[analyze] OpenRouter error body:", text);

    throw new Error(`OpenRouter error ${resp.status}: ${text}`);
  }

  const json: any = await resp.json();

  const raw = String(
    json?.choices?.[0]?.message?.content || "",
  ).trim();

  console.log("[analyze] OpenRouter raw response:", raw);

  const parsed = parseJsonObject(raw);

  if (!parsed) {
    console.error(
      "[analyze] JSON parse error: unable to extract JSON object",
    );

    throw new Error(
      `Failed to parse OpenRouter JSON response: ${raw}`,
    );
  }

  console.log("[analyze] Parsed:", JSON.stringify(parsed));

  return journalAnalysisFromParsed(parsed);
}