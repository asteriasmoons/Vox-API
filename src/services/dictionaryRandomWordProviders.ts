/**
 * Random vocabulary providers for Markly Word Discovery.
 * API Ninjas key stays on the server; none of these services supplies
 * definitions. Dictionary enrichment remains in dictionaryAggregator.
 */
type Provider = "random-word-api" | "api-ninjas" | "random-word-form";
const providers: Provider[] = ["random-word-api", "api-ninjas", "random-word-form"];

async function fetchJSON(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`Random word provider HTTP ${response.status}`);
  return response.json();
}

function normalizeWords(data: unknown): string[] {
  const values = Array.isArray(data) ? data : typeof data === "string" ? [data] :
    data && typeof data === "object" && "word" in data
      ? [(data as { word: unknown }).word] : [];
  return values.filter((value): value is string =>
    typeof value === "string" &&
    /^[a-z]+(?:[-'][a-z]+)*$/i.test(value.trim()) &&
    value.trim().length <= 60
  ).map((value) => value.trim().toLowerCase());
}

async function requestProvider(provider: Provider): Promise<string[]> {
  switch (provider) {
    case "random-word-api": {
      // Favor the provider's highest difficulty settings for advanced vocabulary.
      const diff = 4 + Math.floor(Math.random() * 2);
      return normalizeWords(await fetchJSON(
        `https://random-word-api.herokuapp.com/word?number=30&diff=${diff}`
      ));
    }
    case "api-ninjas": {
      const key = process.env.API_NINJAS_API_KEY || process.env.API_NINJAS_KEY;
      if (!key) return [];
      return normalizeWords(await fetchJSON(
        "https://api.api-ninjas.com/v2/randomword",
        { "X-Api-Key": key }
      ));
    }
    case "random-word-form": {
      const type = Math.random() < 0.5 ? "noun" : "adjective";
      return normalizeWords(await fetchJSON(
        `https://random-word-form.herokuapp.com/random/${type}?count=5`
      ));
    }
  }
}

/** Fetch fresh candidates, rotating starting provider to distribute traffic. */
export async function fetchRandomWordCandidates(
  excluded: ReadonlySet<string>,
): Promise<string[]> {
  const start = Math.floor(Math.random() * providers.length);
  const ordered = [...providers.slice(start), ...providers.slice(0, start)];
  const words: string[] = [];
  const seen = new Set([...excluded].map((word) => word.toLowerCase()));
  for (const provider of ordered) {
    try {
      for (const word of await requestProvider(provider)) {
        if (!seen.has(word)) {
          seen.add(word);
          words.push(word);
        }
      }
    } catch (error) {
      console.warn("[vox:dictionary] random word provider unavailable", {
        provider,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return words;
}
