/**
 * AI-driven word discovery: choose a random letter and vocabulary category,
 * ask Groq for authentic candidates, then let the existing dictionary engine
 * verify and enrich the selected word.
 */
const CATEGORIES = ["uncommon", "sophisticated", "obscure"] as const;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function generateDiscoveryCandidates(
  excluded: ReadonlySet<string>,
): Promise<string[]> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY");

  const letter = LETTERS.charAt(Math.floor(Math.random() * LETTERS.length));
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const excludedWords = [...excluded].slice(-30);
  const prompt = [
    `Generate 20 authentic English vocabulary words beginning with the letter "${letter.toUpperCase()}".`,
    `Category: ${category}.`,
    "Uncommon means rarely encountered but useful; sophisticated means advanced, nuanced literary or academic vocabulary; obscure means exceptionally rare, unusual or specialized vocabulary.",
    "Never include everyday, basic, familiar, beginner-level words, proper nouns, invented words, or phrases.",
    "Vary the parts of speech. Prefer interesting, distinctive words with established dictionary definitions.",
    excludedWords.length ? `Do not include: ${excludedWords.join(", ")}.` : "",
    'Return ONLY a JSON object with a "words" array of 20 lowercase strings. No explanations.',
  ]
    .filter(Boolean)
    .join("\n");

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
        {
          role: "system",
          content:
            "You are an expert English lexicographer. Produce only genuine, uncommon or advanced dictionary headwords. Follow the requested initial letter and JSON format exactly.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.9,
      max_completion_tokens: 1200,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Groq discovery HTTP ${response.status}`);

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Groq discovery returned no content");
  const parsed = JSON.parse(raw) as { words?: unknown };
  if (!Array.isArray(parsed.words))
    throw new Error("Groq discovery returned no word list");

  const seen = new Set([...excluded].map((word) => word.toLowerCase()));
  const candidates: string[] = [];
  for (const item of parsed.words) {
    if (typeof item !== "string") continue;
    const word = item.trim().toLowerCase();
    if (
      !/^[a-z]+(?:[-'][a-z]+)*$/.test(word) ||
      word.length > 60 ||
      !word.startsWith(letter) ||
      seen.has(word)
    )
      continue;
    seen.add(word);
    candidates.push(word);
  }

  // Do not always favor the first candidate the model generated.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = current;
  }
  return candidates;
}
