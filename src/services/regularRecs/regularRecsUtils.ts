//
//  regularRecsUtils.ts
//  Generic helpers for the REGULAR recommendation engine.
//

import { REGULAR_MAX_HTTP_RETRIES, REGULAR_SUSPICIOUS_KEYWORDS } from "./regularRecsConfig";

export function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function firstNumber(value: unknown): number | undefined {
  const num = typeof value === "string" ? Number(value) : value;
  return typeof num === "number" && Number.isFinite(num) ? num : undefined;
}

export function extractYear(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return match ? Number(match[0]) : undefined;
}

export function toStringArray(value: unknown, limit = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .slice(0, limit);
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = cleanText(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function stripEditionNoise(title: string): string {
  return title
    .replace(/[:\-–—].*$/g, "")
    .replace(/\((?:[^)]*)\)/g, "")
    .replace(/\b(a novel|special edition|deluxe edition|illustrated edition|collector'?s edition)\b/gi, "")
    .trim();
}

export function normalizeTitle(value: string): string {
  return stripEditionNoise(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAuthor(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeKey(title: string, author: string): string {
  return `${normalizeTitle(title)}|${normalizeAuthor(author)}`;
}

export function normalizeSeriesStem(title: string): string {
  return normalizeTitle(title)
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join(" ");
}

export function suspiciousPenalty(text: string): number {
  const lower = text.toLowerCase();
  let penalty = 0;
  for (const keyword of REGULAR_SUSPICIOUS_KEYWORDS) {
    if (lower.includes(keyword)) penalty += 30;
  }
  return penalty;
}

export function scoreTitleAuthorMatch(
  targetTitle: string,
  targetAuthor: string,
  candidateTitle: string,
  candidateAuthor: string,
): number {
  const nTargetTitle = normalizeTitle(targetTitle);
  const nTargetAuthor = normalizeAuthor(targetAuthor);
  const nCandTitle = normalizeTitle(candidateTitle);
  const nCandAuthor = normalizeAuthor(candidateAuthor);
  if (!nCandTitle) return 0;

  let score = 0;
  if (nTargetTitle && nCandTitle === nTargetTitle) {
    score += 50;
  } else if (
    nTargetTitle &&
    (nCandTitle.includes(nTargetTitle) || nTargetTitle.includes(nCandTitle))
  ) {
    score += 30;
  } else if (nTargetTitle) {
    const targetWords = nTargetTitle.split(" ").filter((w) => w.length > 2);
    const candWords = nCandTitle.split(" ");
    const overlap = targetWords.filter((w) =>
      candWords.some((cw) => cw.includes(w) || w.includes(cw)),
    ).length;
    score += overlap * 8;
  }

  if (nTargetAuthor && nCandAuthor) {
    if (nCandAuthor === nTargetAuthor) score += 25;
    else if (nCandAuthor.includes(nTargetAuthor) || nTargetAuthor.includes(nCandAuthor))
      score += 15;
  }
  return score;
}

export function overlapCount(needles: string[], haystack: string[]): number {
  if (needles.length === 0 || haystack.length === 0) return 0;
  const hay = haystack.map((h) => h.toLowerCase());
  let count = 0;
  for (const needle of needles) {
    const n = needle.toLowerCase();
    if (hay.some((h) => h.includes(n) || n.includes(h))) count += 1;
  }
  return count;
}

export function parseJsonLoose(raw: string): unknown {
  const content = raw.trim();
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  }

  const runners: Array<Promise<void>> = [];
  for (let i = 0; i < size; i++) runners.push(run());
  await Promise.all(runners);
  return results;
}

export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= REGULAR_MAX_HTTP_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (
        (response.status === 429 ||
          response.status === 500 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504) &&
        attempt < REGULAR_MAX_HTTP_RETRIES
      ) {
        const backoff = Math.min(4000, 400 * 2 ** attempt);
        console.warn(`${label} transient ${response.status}; retry in ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < REGULAR_MAX_HTTP_RETRIES) {
        const backoff = Math.min(4000, 400 * 2 ** attempt);
        console.warn(`${label} network error; retry in ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} request failed`);
}

export async function fetchJson<T>(
  url: string | URL,
  timeoutMs: number,
  label: string,
): Promise<T | null> {
  const response = await fetchWithRetry(
    url,
    { method: "GET", headers: { Accept: "application/json" } },
    timeoutMs,
    label,
  );
  if (!response.ok) {
    console.warn(`${label} responded ${response.status}`);
    return null;
  }
  return (await response.json().catch(() => null)) as T | null;
}
