import { Router } from "express";
import { DailyJournalAnalysis } from "../models/DailyJournalAnalysis";
import { extractJournalThemes } from "../services/extractJournalThemes";
import { normalizeTag, tagKey, deduplicateTags } from "../utils/normalizeTag";
import { chicagoDateKey } from "../utils/chicagoDateKey";

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function dateKeyRange(
  period: string,
): { currentStart: string; currentEnd: string; previousStart: string; previousEnd: string } {
  const now = new Date();
  const fmt = (d: Date) => chicagoDateKey(d);

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (period === "week") {
    const dayOfWeek = now.getDay();
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - dayOfWeek);
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setDate(thisWeekStart.getDate() - 1);
    return {
      currentStart: fmt(startOfDay(thisWeekStart)),
      currentEnd: fmt(now),
      previousStart: fmt(startOfDay(lastWeekStart)),
      previousEnd: fmt(startOfDay(lastWeekEnd)),
    };
  }

  if (period === "month") {
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      currentStart: fmt(thisMonthStart),
      currentEnd: fmt(now),
      previousStart: fmt(lastMonthStart),
      previousEnd: fmt(lastMonthEnd),
    };
  }

  if (period === "year") {
    const thisYearStart = new Date(now.getFullYear(), 0, 1);
    const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
    const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);
    return {
      currentStart: fmt(thisYearStart),
      currentEnd: fmt(now),
      previousStart: fmt(lastYearStart),
      previousEnd: fmt(lastYearEnd),
    };
  }

  // "all" — no previous period comparison
  return {
    currentStart: "2000-01-01",
    currentEnd: fmt(now),
    previousStart: "1999-01-01",
    previousEnd: "1999-12-31",
  };
}

interface ThemeInsight {
  name: string;
  entryCount: number;
  mindfulMinutes: number;
  firstUsedDate: string;
  lastUsedDate: string;
  currentPeriodCount: number;
  previousPeriodCount: number;
  changeAmount: number;
  changePercentage: number;
  trend: "emerging" | "declining" | "new" | "steady";
  relatedThemes: string[];
}

function computeTrend(current: number, previous: number): "emerging" | "declining" | "new" | "steady" {
  if (previous === 0 && current > 0) return "new";
  if (current === 0 && previous > 0) return "declining";
  if (previous === 0 && current === 0) return "steady";
  const pct = ((current - previous) / previous) * 100;
  if (pct >= 25) return "emerging";
  if (pct <= -25) return "declining";
  return "steady";
}

// ─── GET /api/journal/insights ──────────────────────────────────────────────
// Overview: most common themes, trends, stats.
// Query: userId, period (week|month|year|all)

router.get("/", async (req, res) => {
  try {
    const userId = String(req.query?.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const period = String(req.query?.period || "month").trim();
    const range = dateKeyRange(period);

    // Fetch current period analyses
    const currentDocs = await DailyJournalAnalysis.find({
      userId,
      dateKey: { $gte: range.currentStart, $lte: range.currentEnd },
    }).lean();

    // Fetch previous period analyses for trend comparison
    const previousDocs = await DailyJournalAnalysis.find({
      userId,
      dateKey: { $gte: range.previousStart, $lte: range.previousEnd },
    }).lean();

    // Count themes in current period
    const currentCounts = new Map<string, { count: number; minutes: number; dates: string[] }>();
    const coOccurrences = new Map<string, Map<string, number>>();

    for (const doc of currentDocs) {
      const allLabels = [
        ...doc.themes.map((t) => normalizeTag(t)),
        ...(doc.tags || []).map((t) => normalizeTag(t)),
      ];
      const unique = deduplicateTags(allLabels);

      for (const theme of unique) {
        const key = tagKey(theme);
        const existing = currentCounts.get(key) || { count: 0, minutes: 0, dates: [] };
        existing.count += 1;
        existing.minutes += doc.mindfulMinutes || 0;
        existing.dates.push(doc.dateKey);
        currentCounts.set(key, existing);
      }

      // Track co-occurrences
      for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
          const uA = unique[i];
          const uB = unique[j];
          if (!uA || !uB) continue;
          const a = tagKey(uA);
          const b = tagKey(uB);
          if (!coOccurrences.has(a)) coOccurrences.set(a, new Map());
          if (!coOccurrences.has(b)) coOccurrences.set(b, new Map());
          coOccurrences.get(a)!.set(b, (coOccurrences.get(a)!.get(b) || 0) + 1);
          coOccurrences.get(b)!.set(a, (coOccurrences.get(b)!.get(a) || 0) + 1);
        }
      }
    }

    // Count themes in previous period
    const previousCounts = new Map<string, number>();
    for (const doc of previousDocs) {
      const allLabels = [
        ...doc.themes.map((t) => normalizeTag(t)),
        ...(doc.tags || []).map((t) => normalizeTag(t)),
      ];
      const unique = deduplicateTags(allLabels);
      for (const theme of unique) {
        const key = tagKey(theme);
        previousCounts.set(key, (previousCounts.get(key) || 0) + 1);
      }
    }

    // Fetch all-time data for first/last used
    const allDocs = await DailyJournalAnalysis.find(
      { userId },
      { themes: 1, tags: 1, dateKey: 1, _id: 0 },
    )
      .sort({ dateKey: 1 })
      .lean();

    const firstSeen = new Map<string, string>();
    const lastSeen = new Map<string, string>();
    let totalEntries = 0;
    let totalMinutes = 0;
    const uniqueThemeKeys = new Set<string>();

    for (const doc of allDocs) {
      totalEntries++;
      const allLabels = [
        ...doc.themes.map((t) => normalizeTag(t)),
        ...((doc as any).tags || []).map((t: string) => normalizeTag(t)),
      ];
      const unique = deduplicateTags(allLabels);
      for (const theme of unique) {
        const key = tagKey(theme);
        uniqueThemeKeys.add(key);
        if (!firstSeen.has(key)) firstSeen.set(key, doc.dateKey);
        lastSeen.set(key, doc.dateKey);
      }
    }

    for (const doc of currentDocs) {
      totalMinutes += doc.mindfulMinutes || 0;
    }

    // Build display name map
    const displayNames = new Map<string, string>();
    for (const doc of [...currentDocs, ...previousDocs, ...allDocs]) {
      for (const t of [...doc.themes, ...((doc as any).tags || [])]) {
        const key = tagKey(t);
        if (!displayNames.has(key)) {
          displayNames.set(key, normalizeTag(t));
        }
      }
    }

    // Build insights
    const insights: ThemeInsight[] = [];
    for (const [key, data] of currentCounts) {
      const prev = previousCounts.get(key) || 0;
      const change = data.count - prev;
      const pct = prev > 0 ? Math.round((change / prev) * 100) : data.count > 0 ? 100 : 0;
      const related = coOccurrences.get(key);
      const topRelated = related
        ? Array.from(related.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k]) => displayNames.get(k) || k)
        : [];

      insights.push({
        name: displayNames.get(key) || key,
        entryCount: data.count,
        mindfulMinutes: data.minutes,
        firstUsedDate: firstSeen.get(key) || data.dates[0] || "",
        lastUsedDate: lastSeen.get(key) || data.dates[data.dates.length - 1] || "",
        currentPeriodCount: data.count,
        previousPeriodCount: prev,
        changeAmount: change,
        changePercentage: pct,
        trend: computeTrend(data.count, prev),
        relatedThemes: topRelated,
      });
    }

    // Also add themes only in previous period (declining to zero)
    for (const [key, count] of previousCounts) {
      if (!currentCounts.has(key)) {
        insights.push({
          name: displayNames.get(key) || key,
          entryCount: 0,
          mindfulMinutes: 0,
          firstUsedDate: firstSeen.get(key) || "",
          lastUsedDate: lastSeen.get(key) || "",
          currentPeriodCount: 0,
          previousPeriodCount: count,
          changeAmount: -count,
          changePercentage: -100,
          trend: "declining",
          relatedThemes: [],
        });
      }
    }

    // Sort by current entry count descending
    insights.sort((a, b) => b.entryCount - a.entryCount);

    const emerging = insights.filter((i) => i.trend === "emerging");
    const declining = insights.filter((i) => i.trend === "declining");
    const newThemes = insights.filter((i) => i.trend === "new");

    return res.json({
      period,
      overview: {
        totalEntries: currentDocs.length,
        totalMindfulMinutes: totalMinutes,
        uniqueThemes: uniqueThemeKeys.size,
      },
      mostCommon: insights.slice(0, 10),
      emerging,
      declining,
      new: newThemes,
      allThemes: insights,
    });
  } catch (error) {
    console.error("Journal insights error:", error);
    return res.status(500).json({ error: "Failed to generate insights" });
  }
});

// ─── GET /api/journal/insights/:theme ───────────────────────────────────────
// Detail for a single theme.

router.get("/:theme", async (req, res) => {
  try {
    const userId = String(req.query?.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const themeParam = decodeURIComponent(req.params.theme);
    const targetKey = tagKey(themeParam);
    const displayName = normalizeTag(themeParam);

    // All analyses for this user that contain this theme
    const allDocs = await DailyJournalAnalysis.find({ userId })
      .sort({ dateKey: 1 })
      .lean();

    const matchingDocs = allDocs.filter((doc) => {
      const allLabels = [
        ...doc.themes.map((t) => normalizeTag(t)),
        ...((doc as any).tags || []).map((t: string) => normalizeTag(t)),
      ];
      return allLabels.some((t) => tagKey(t) === targetKey);
    });

    if (matchingDocs.length === 0) {
      return res.json({
        name: displayName,
        entryCount: 0,
        mindfulMinutes: 0,
        firstUsedDate: null,
        lastUsedDate: null,
        usageByMonth: [],
        relatedThemes: [],
        entries: [],
      });
    }

    let totalMinutes = 0;
    const usageByMonth = new Map<string, number>();
    const relatedCounts = new Map<string, number>();

    for (const doc of matchingDocs) {
      totalMinutes += doc.mindfulMinutes || 0;

      // Month key: YYYY-MM
      const monthKey = doc.dateKey.substring(0, 7);
      usageByMonth.set(monthKey, (usageByMonth.get(monthKey) || 0) + 1);

      // Related themes
      const allLabels = deduplicateTags([
        ...doc.themes.map((t) => normalizeTag(t)),
        ...((doc as any).tags || []).map((t: string) => normalizeTag(t)),
      ]);
      for (const label of allLabels) {
        const key = tagKey(label);
        if (key !== targetKey) {
          relatedCounts.set(key, (relatedCounts.get(key) || 0) + 1);
        }
      }
    }

    // Build display name map for related themes
    const displayNames = new Map<string, string>();
    for (const doc of matchingDocs) {
      for (const t of [...doc.themes, ...((doc as any).tags || [])]) {
        const key = tagKey(t);
        if (!displayNames.has(key)) displayNames.set(key, normalizeTag(t));
      }
    }

    const topRelated = Array.from(relatedCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, count]) => ({
        name: displayNames.get(key) || key,
        coOccurrences: count,
      }));

    const usageTimeline = Array.from(usageByMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count }));

    // Return entry summaries (dateKey, mood, themes — not full reflection)
    const entrySummaries = matchingDocs.map((doc) => ({
      dateKey: doc.dateKey,
      bookId: doc.bookId,
      mood: doc.mood,
      themes: doc.themes,
      mindfulMinutes: doc.mindfulMinutes || 0,
    }));

    return res.json({
      name: displayName,
      entryCount: matchingDocs.length,
      mindfulMinutes: totalMinutes,
      firstUsedDate: matchingDocs[0]?.dateKey ?? "",
      lastUsedDate: matchingDocs[matchingDocs.length - 1]?.dateKey ?? "",
      usageByMonth: usageTimeline,
      relatedThemes: topRelated,
      entries: entrySummaries,
    });
  } catch (error) {
    console.error("Theme detail error:", error);
    return res.status(500).json({ error: "Failed to fetch theme detail" });
  }
});

// ─── POST /api/journal/extract-themes ───────────────────────────────────────
// Dedicated AI theme extraction endpoint.

router.post("/extract-themes", async (req, res) => {
  try {
    const entries: { title: string; body: string; tags?: string[] }[] =
      req.body?.entries ?? [];

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: "No entries provided" });
    }

    const result = await extractJournalThemes(entries);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Theme extraction error:", message);
    return res.status(500).json({ error: message || "Failed to extract themes" });
  }
});

// ─── POST /api/journal/insights/backfill ────────────────────────────────────
// Bulk-update existing DailyJournalAnalysis records with tags + mindfulMinutes
// from the client's local SwiftData store. Idempotent — safe to call repeatedly.

router.post("/backfill", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const records: {
      dateKey: string;
      bookId: string;
      tags: string[];
      mindfulMinutes: number;
      entryCount: number;
    }[] = req.body?.records ?? [];

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "No records provided" });
    }

    let updated = 0;
    let created = 0;

    const ops = records.map(async (record) => {
      const normalizedTags = (record.tags || []).map((t) => normalizeTag(t));
      const deduped = deduplicateTags(normalizedTags);

      const result = await DailyJournalAnalysis.findOneAndUpdate(
        { userId, bookId: record.bookId, dateKey: record.dateKey },
        {
          $set: {
            tags: deduped,
            mindfulMinutes: record.mindfulMinutes || 0,
            entryCount: record.entryCount || 1,
          },
        },
        { new: true },
      );

      if (result) {
        updated++;
      }
    });

    await Promise.all(ops);

    console.log(
      `[backfill] userId=${userId}: updated=${updated}, total records=${records.length}`,
    );

    return res.json({ updated, total: records.length });
  } catch (error) {
    console.error("Backfill error:", error);
    return res.status(500).json({ error: "Failed to backfill" });
  }
});

export default router;
