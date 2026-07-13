/**
 * Normalize a tag/theme string for consistent comparison and deduplication.
 *
 * Steps:
 *  1. Trim whitespace
 *  2. Strip leading # symbols
 *  3. Split camelCase / PascalCase into words
 *  4. Replace hyphens and underscores with spaces
 *  5. Collapse multiple spaces
 *  6. Title-case each word
 *
 * Examples:
 *   "#PersonalGrowth"   → "Personal Growth"
 *   "personal growth"   → "Personal Growth"
 *   "personal-growth"   → "Personal Growth"
 *   "SELF_CARE"         → "Self Care"
 */
export function normalizeTag(raw: string): string {
  let tag = raw.trim().replace(/^#+/, "");

  // Split camelCase / PascalCase: "PersonalGrowth" → "Personal Growth"
  tag = tag.replace(/([a-z])([A-Z])/g, "$1 $2");

  // Replace hyphens and underscores with spaces
  tag = tag.replace(/[-_]+/g, " ");

  // Collapse multiple spaces
  tag = tag.replace(/\s+/g, " ").trim();

  // Title-case each word
  return tag
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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
