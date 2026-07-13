/**
 * Normalize a tag/theme string for consistent comparison and deduplication.
 *
 * Steps:
 *  1. Trim whitespace
 *  2. Strip leading # symbols
 *  3. Split camelCase / PascalCase into words
 *  4. Replace hyphens and underscores with spaces
 *  5. Collapse multiple spaces
 *  6. Strip trailing "s" for plural merging (simple English plurals)
 *  7. Title-case each word
 *
 * Examples:
 *   "#PersonalGrowth"   → "Personal Growth"
 *   "personal growth"   → "Personal Growth"
 *   "personal-growth"   → "Personal Growth"
 *   "SELF_CARE"         → "Self Care"
 *   "Routines"          → "Routine"
 *   "Habits"            → "Habit"
 */
export function normalizeTag(raw: string): string {
  let tag = raw.trim().replace(/^#+/, "");

  // Split camelCase / PascalCase: "PersonalGrowth" → "Personal Growth"
  tag = tag.replace(/([a-z])([A-Z])/g, "$1 $2");

  // Replace hyphens and underscores with spaces
  tag = tag.replace(/[-_]+/g, " ");

  // Collapse multiple spaces
  tag = tag.replace(/\s+/g, " ").trim();

  // Title-case each word and singularize simple plurals
  return tag
    .split(" ")
    .map((w) => {
      let word = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      word = singularize(word);
      return word;
    })
    .join(" ");
}

/**
 * Simple English singularization. Handles common patterns without a full
 * NLP library. Preserves words that are already singular or are exceptions.
 */
function singularize(word: string): string {
  const lower = word.toLowerCase();

  // Exception list — words that end in 's' but are already singular,
  // or whose singular form is irregular
  const exceptions: Record<string, string> = {
    apps: "App",
    progress: "Progress",
    stress: "Stress",
    success: "Success",
    wellness: "Wellness",
    fitness: "Fitness",
    mindfulness: "Mindfulness",
    kindness: "Kindness",
    happiness: "Happiness",
    sadness: "Sadness",
    loneliness: "Loneliness",
    awareness: "Awareness",
    consciousness: "Consciousness",
    focus: "Focus",
    analysis: "Analysis",
    basis: "Basis",
    crisis: "Crisis",
    series: "Series",
    species: "Species",
    news: "News",
    process: "Process",
    status: "Status",
    bus: "Bus",
    plus: "Plus",
    us: "Us",
    thus: "Thus",
    bonus: "Bonus",
    campus: "Campus",
    consensus: "Consensus",
    alias: "Alias",
    atlas: "Atlas",
    canvas: "Canvas",
    chaos: "Chaos",
    cosmos: "Cosmos",
    nexus: "Nexus",
    surplus: "Surplus",
    contentment: "Contentment",
  };

  if (exceptions[lower]) {
    // Preserve the original casing style
    return word.charAt(0).toUpperCase() + exceptions[lower].slice(1);
  }

  // Don't touch short words
  if (word.length <= 3) return word;

  // -ies → -y  (e.g., "Entries" → "Entry", "Routines" stays as-is — not -ies)
  if (lower.endsWith("ies") && word.length > 4) {
    return word.slice(0, -3) + "y";
  }

  // -ses → -se (e.g., "Responses" → "Response")
  if (lower.endsWith("ses") && word.length > 4) {
    return word.slice(0, -1);
  }

  // -ves → -fe (e.g., "Lives" → "Life")  — skip, too risky for tag names

  // -es after sh/ch/x/z/ss → drop -es
  if (
    lower.endsWith("es") &&
    (lower.endsWith("shes") ||
      lower.endsWith("ches") ||
      lower.endsWith("xes") ||
      lower.endsWith("zes"))
  ) {
    return word.slice(0, -2);
  }

  // Generic trailing -s (but not -ss, -us)
  if (
    lower.endsWith("s") &&
    !lower.endsWith("ss") &&
    !lower.endsWith("us") &&
    !lower.endsWith("is")
  ) {
    return word.slice(0, -1);
  }

  return word;
}

/**
 * Generate a stable key for grouping equivalent tags.
 * Strips all non-alphanumeric characters and lowercases.
 */
export function tagKey(raw: string): string {
  return normalizeTag(raw).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * Deduplicate an array of tags, preserving the first-seen display form
 * after normalization.
 */
export function deduplicateTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tags) {
    const key = tagKey(t);
    if (!seen.has(key)) {
      seen.set(key, normalizeTag(t));
    }
  }
  return Array.from(seen.values());
}
