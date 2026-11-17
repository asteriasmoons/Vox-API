import { buildDiscoveryPrompt } from "./discoveryPromptBuilder";
import type { DiscoveryCategory, DiscoveryDifficulty } from "./discoveryTypes";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GenerateDiscoveryCandidatesOptions {
  category: DiscoveryCategory;
  difficulty: DiscoveryDifficulty;
  excludedWords?: ReadonlySet<string>;
  candidateCount?: number;
}

/**
 * Requests category- and difficulty-specific candidate headwords from Groq.
 * Candidates still require verification through the dictionary aggregator.
 */
export async function generateDiscoveryCandidates({
  category,
  difficulty,
  excludedWords = new Set<string>(),
  candidateCount = 20,
}: GenerateDiscoveryCandidatesOptions): Promise<string[]> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY");

  const prompt = buildDiscoveryPrompt({
    category,
    difficulty,
    excludedWords: [...excludedWords],
    candidateCount,
  });

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:
        process.env.DICTIONARY_DISCOVERY_GROQ_MODEL || "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.9,
      max_completion_tokens: 1200,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Groq discovery HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Groq discovery returned no content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Groq discovery returned invalid JSON");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("words" in parsed) ||
    !Array.isArray(parsed.words)
  ) {
    throw new Error("Groq discovery returned no word list");
  }

  const seen = new Set(
    [...excludedWords].map((word) => word.trim().toLowerCase()),
  );
  const candidates: string[] = [];

  for (const item of parsed.words) {
    if (typeof item !== "string") continue;
    const word = item.trim().toLowerCase();
    if (
      !/^[a-z]+(?:[-'][a-z]+)*$/.test(word) ||
      word.length > 60 ||
      seen.has(word)
    ) {
      continue;
    }
    seen.add(word);
    candidates.push(word);
  }

  // Avoid always favoring the first candidate returned by Groq.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }

  return candidates;
}
