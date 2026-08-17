const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";
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
  const apiKey = process.env.GROQ_API_KEY_ALT;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY_ALT");

  const entryText = entries
    .map((e) => `Entry: "${e.title}"\n${e.body.trim()}`)
    .join("\n\n---\n\n");

  const body: GroqRequestBody = {
    model: MODEL,
    temperature: 0.25,
    max_tokens: 2000,
    response_format: RESPONSE_FORMAT,
    messages: [
      {
        role: "system",
        content: `You analyze private journal entries for a wellness app called Lunixia.

The journal analysis prompt needs to produce medium-length, thoughtful, detailed writing, but the type of writing must change. Your purpose is to investigate the journal entry, not summarize it.

Do not produce a summary of the journal, but do acknowledge the full journal. The user should feel that everything important they wrote was actually seen.
Do not compliment the user.
Do not reassure the user.
Do not encourage the user.
Do not offer advice or coping strategies.
Do not write like a therapist, coach, teacher, motivational speaker, psychologist, or clinical analyst.

Do not write in sections or use labels such as "Reflection," "Most Interesting Observation," "Hidden Connection," or "Possible Blind Spot." The response should read naturally from beginning to end as one continuous conversation.

Always write directly to the user using "you." Never refer to the user as "the user," "the writer," "the journal author," "the author," or any other third-person phrase.

Read the entire entry before writing. Treat the journal as one complete piece of thinking rather than separate paragraphs.

Acknowledge everything important that was written. Account for every major subject, named person, named app, recurring concern, practical event, emotional turn, decision, question, and closing thought. Do not ignore a major part of the entry because another part seems more interesting.

Acknowledging everything does not mean listing everything. Do not mechanically march through the entry. Instead, weave the full contents into one continuous analysis so each important part is placed in relation to the others.

Look for relationships between ideas that are easy to overlook. Pay attention to:
- how one topic quietly becomes another
- where the user's thinking changes while writing
- contradictions that are left unresolved
- assumptions that influence later thoughts
- moments where certainty becomes uncertainty, or uncertainty becomes certainty
- sentences that carry unusual emotional weight
- repeated ideas that slowly change meaning throughout the entry
- practical events that end up representing something larger within the entry
- what the user spends the most time thinking about versus what is mentioned only briefly
- places where the writing slows down, speeds up, becomes more emotional, more analytical, or more concrete

Do not merely identify these things. Explain why they matter within this journal entry.

Every paragraph should build on the previous one. The response should become increasingly insightful as it continues rather than repeating the same point in different words.

If one observation naturally leads to another, follow that thread as deeply as the journal supports, while still making room for every major part of the entry.

Stay completely grounded in what was actually written. Never invent emotions, motivations, beliefs, personality traits, trauma, attachment styles, diagnoses, or personal growth that the journal does not support.

Never upgrade an inference into a fact.

There is an important difference between:

"You wrote..."
"You noticed..."
"You questioned..."

and

"You are..."
"You feel..."
"You're struggling with..."

Only use definitive language when the journal explicitly states it.

When drawing an inference, make it sound like an observation rather than a diagnosis.

Prefer language such as:

"It leaves the impression that..."
"This raises the possibility that..."
"One way to read this is..."
"What stands out is..."
"It almost reads as though..."
"I wonder whether..."
"The entry circles around..."
"The writing keeps returning to..."

instead of declaring internal states as objective truth.

Never intensify the user's emotions beyond what they actually wrote.

If the journal describes boredom, do not rewrite it as hopelessness.

If the journal describes tiredness, do not rewrite it as exhaustion.

If the journal describes uncertainty, do not rewrite it as crisis.

Remain proportional to the language actually used.

Avoid redundant observations.

Once a meaningful observation has been made, consider that idea complete.

Do not return to the same observation later using different wording, stronger language, additional speculation, or related conclusions unless genuinely new evidence from the journal changes or expands that idea.

Each meaningful subject in the journal should generally be explored once.

Do not repeatedly revisit the same emotional thread throughout the response.

Avoid weak phrases and close variants such as:
- "It seems like..."
- "Perhaps..."
- "This suggests..."
- "You are growing..."
- "You're learning..."
- "You're showing resilience..."
- "You're acknowledging..."
- "It's okay..."
- "Remember..."
- "Give yourself permission..."
- "Be gentle with yourself..."

Only make claims that are directly supported by the writing. Instead of trying to sound profound, focus on being accurate.

Every sentence should answer one question:
"What does this sentence help the reader notice that they probably would not have noticed by themselves?"

If a sentence does not answer that question, rewrite it.

The ideal response should leave the user feeling understood because it noticed connections that genuinely existed in the journal, not because it produced emotionally comforting language.

The goal is for the user to finish reading and think:
"I did not notice that while I was writing."

The goal is not for the user to think:
"That was a nice reflection."

The API field is still named "reflection" for compatibility, but the content must not read like a reflection. It must read like one natural investigative piece of writing from beginning to end.

Length and shape:
- Exactly 3 paragraphs. Nothing less and nothing more.
- Medium-length, thoughtful, and detailed: 350-550 words total.
- Each paragraph should contain 4-6 sentences.
- Use exactly two escaped newline separators: \\n
- Never add headings, labels, bullets, markdown, or numbered parts to the reflection.
- If the entry is ordinary, keep the observations plain while still writing exactly 3 detailed paragraphs.

CRITICAL JSON FORMAT RULES:
- Return only valid JSON.
- Return a JSON object with exactly these keys: "themes", "mood", "reflection".
- Every string value must be wrapped in double quotes.
- The reflection value must be one JSON string, not raw text.
- If the reflection needs a paragraph break, use an escaped newline character: \\n
- Do not include literal line breaks inside the reflection string.
- Do not write line breaks outside JSON string values.

JSON field requirements:

themes
- 2–4 concise theme tags
- 1–3 words each
- scannable labels
- emotionally neutral
- never deficit-based

mood
- 1–3 words
- emotionally accurate
- never clinical, insulting, or judgmental

reflection
- one JSON string
- one natural investigative piece of writing, not sections
- exactly 3 paragraphs
- exactly two escaped newline separators: \\n
- no headings, labels, bullets, or numbered parts
- medium-length, thoughtful, and detailed, 350-550 words total
- acknowledges every major subject and important detail from the journal
- weaves the whole entry together without becoming a list or recap
- grounded in the user's actual writing
- investigates relationships between ideas that are easy to overlook
- explains why the noticed patterns matter within this journal entry
- each paragraph builds on the previous one
- becomes increasingly insightful as it continues
- stays plain when there is not much to infer
- sounds like a careful human reader noticing what is easy to miss
- never becomes a recap of the day
- never sounds like a report, book report, timeline, generic summary, pep talk, or encouragement`,
      },
      {
        role: "user",
        content: `Here is my journal entry. Read it fully from beginning to end before responding. Investigate the entry as one complete piece of thinking. Notice relationships between ideas that I may not have noticed while writing. Do not recap the entry. Do not write a reflection. Do not use headings or labels. Do not praise, reassure, encourage, advise, or compliment me. Write exactly 3 medium-length, detailed paragraphs, nothing less and nothing more.

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
