/**
 * Reject everyday vocabulary before expensive dictionary enrichment.
 * Datamuse md=f reports corpus frequency per million tokens.
 * Missing frequency is not proof of rarity: require a positive measurement.
 */
const MAX_FREQUENCY_PER_MILLION = 1.0;

export async function isDiscoveryVocabulary(word: string): Promise<boolean> {
  const params = new URLSearchParams({ sp: word, md: "f", max: "10" });
  try {
    const response = await fetch(`https://api.datamuse.com/words?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return false;
    const exact = data.find((row: unknown) => {
      if (!row || typeof row !== "object") return false;
      const candidate = (row as { word?: unknown }).word;
      return (
        typeof candidate === "string" &&
        candidate.toLowerCase() === word.toLowerCase()
      );
    }) as { tags?: unknown } | undefined;
    if (!exact || !Array.isArray(exact.tags)) return false;
    const frequencyTag = exact.tags.find(
      (tag: unknown) => typeof tag === "string" && tag.startsWith("f:"),
    ) as string | undefined;
    if (!frequencyTag) return false;
    const frequency = Number(frequencyTag.slice(2));
    return (
      Number.isFinite(frequency) &&
      frequency > 0 &&
      frequency <= MAX_FREQUENCY_PER_MILLION
    );
  } catch (error) {
    console.warn("[vox:dictionary] frequency lookup unavailable", {
      word,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
