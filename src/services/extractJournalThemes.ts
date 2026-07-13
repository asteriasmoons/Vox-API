import { normalizeTag } from "../utils/normalizeTag";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

export interface ThemeExtractionResult {
  /** AI-detected broad thematic patterns */
  themes: string[];
  /** Suggested normalized tags for the entry */
  suggestedTags: string[];
}

interface EntryInput {
  title: string;
  body: string;
  tags?: string[];
}

export async function extractJournalThemes(
  entries: EntryInput[],
): Promise<ThemeExtractionResult> {
  const apiKey = process.env.GROQ_API_KEY_ALT;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY_ALT");

  const entryText = entries
    .map((e) => {
      let block = `Entry: "${e.title}"\n${e.body.trim()}`;
      if (e.tags && e.tags.length > 0) {
        block += `\nUser Tags: ${e.tags.join(", ")}`;
      }
      return block;
    })
    .join("\n\n---\n\n");

  const body = {
    model: MODEL,
    temperature: 0.15,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a journal theme extraction system. Your job is to identify recurring themes and suggest tags from journal entries.

You receive one or more journal entries, each potentially with user-created tags.

Return a JSON object with exactly these keys:

"themes" — an array of 3–6 broad thematic patterns detected across the entries. These are higher-level categories that describe what the writing is about at a conceptual level. Examples: "Personal Growth", "Relationships", "Creative Expression", "Daily Routines", "Work Reflection", "Emotional Processing", "Health Awareness", "Goal Setting".

"suggestedTags" — an array of 3–8 specific, concise tags (1–3 words each) that would be useful for filtering and organizing these entries. These should be more specific than themes. If the user already provided tags, include normalized versions of those plus any additional relevant ones. Examples: "morning routine", "app development", "family", "reading", "meditation", "budgeting".

Rules:
- Use neutral, descriptive language. Never evaluative or judgmental.
- Themes should be broad enough to appear across multiple entries over time.
- Tags should be specific enough to be useful for filtering.
- Do not invent themes that are not grounded in the text.
- Normalize all output: title case for themes, lowercase for tags.
- Return valid JSON only.`,
      },
      {
        role: "user",
        content: `Extract themes and suggest tags from these journal entries:\n\n${entryText}`,
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let resp: Response;
  try {
    resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === "AbortError")
      throw new Error("Groq request timed out after 30s");
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Groq error ${resp.status}: ${text}`);
  }

  const json: any = await resp.json();
  const raw = String(json?.choices?.[0]?.message?.content || "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse Groq JSON response: ${raw}`);
  }

  const themes = Array.isArray(parsed.themes)
    ? parsed.themes.map((t: any) => normalizeTag(String(t))).filter(Boolean)
    : [];

  const suggestedTags = Array.isArray(parsed.suggestedTags)
    ? parsed.suggestedTags
        .map((t: any) => String(t).trim().toLowerCase())
        .filter(Boolean)
    : [];

  if (themes.length === 0) {
    throw new Error("Groq returned no themes");
  }

  return { themes, suggestedTags };
}
