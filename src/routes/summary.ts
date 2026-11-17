import { Router } from "express";

const router = Router();

/**
 * POST /api/books/summary
 * body: { title, author? }
 *
 * Uses Google Books + Open Library fallback
 */
router.post("/", async (req, res) => {
  try {
    const rawTitle = String(req.body?.title || "").trim();
    const rawAuthor = String(req.body?.author || "").trim();

    if (!rawTitle) {
      return res.status(400).json({ error: "Title is required" });
    }

    // ---------- helpers ----------
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/['']/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const stripSubtitle = (t: string) => (t.split(":")[0] ?? t).trim();

    const tokens = (s: string) =>
      new Set(normalize(s).split(" ").filter(Boolean));

    const overlap = (a: Set<string>, b: Set<string>) => {
      if (!a.size || !b.size) return 0;
      let inter = 0;
      for (const x of a) if (b.has(x)) inter++;
      const minSize = Math.min(a.size, b.size);
      return minSize ? inter / minSize : 0;
    };

    const titleA = rawTitle;
    const titleB = (rawTitle.split(":")[0] ?? rawTitle).trim();
    const authorA = rawAuthor;

    const titleTokensFull = tokens(titleA);
    const titleTokensShort = tokens(titleB);
    const authorTokens = tokens(authorA);

    const scoreTitle = (candidateTitle: string) => {
      const cTok = tokens(candidateTitle);
      const full = overlap(titleTokensFull, cTok);
      const short = overlap(titleTokensShort, cTok);
      return Math.max(full, short);
    };

    const scoreAuthor = (candidateAuthor: string) => {
      if (!rawAuthor) return 0;
      const cTok = tokens(candidateAuthor);
      return overlap(authorTokens, cTok);
    };

    const totalScore = (candTitle: string, candAuthor: string) => {
      const t = scoreTitle(candTitle);
      const a = scoreAuthor(candAuthor);
      return rawAuthor ? t * 0.7 + a * 0.3 : t;
    };

    const PASS_THRESHOLD = rawAuthor ? 0.25 : 0.35;
    const MIN_AUTHOR_IF_PROVIDED = rawAuthor ? 0.05 : 0;

    console.log("📚 Search input:", { rawTitle, rawAuthor });

    // ---------- Google Books ----------
    try {
      let q = rawTitle;
      if (rawAuthor) q = `${rawTitle} ${rawAuthor}`;

      const apiKey = process.env.GOOGLE_BOOKS_API_KEY || "";

      const gbUrl =
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}` +
        `&maxResults=20&printType=books&langRestrict=en` +
        (apiKey ? `&key=${apiKey}` : "");

      const gbResp = await fetch(gbUrl);

      if (gbResp.ok) {
        const gb: any = await gbResp.json();
        const items = Array.isArray(gb?.items) ? gb.items : [];

        let best: any = null;
        let bestScore = 0;

        for (const item of items) {
          const info = item?.volumeInfo || {};
          const candTitle = String(info?.title || "").trim();
          const candAuthors = Array.isArray(info?.authors)
            ? info.authors.join(", ")
            : "";

          if (!candTitle) continue;

          const aScore = scoreAuthor(candAuthors);
          const s = totalScore(candTitle, candAuthors);

          const desc =
            typeof info?.description === "string"
              ? info.description.trim()
              : "";

          if (!desc) continue;
          if (rawAuthor && aScore < MIN_AUTHOR_IF_PROVIDED) continue;

          if (s > bestScore) {
            bestScore = s;
            best = { candTitle, candAuthors, summary: desc };
          }
        }

        if (best && bestScore >= PASS_THRESHOLD) {
          return res.json({
            source: "google_books",
            title: best.candTitle || rawTitle,
            author: best.candAuthors || rawAuthor,
            summary: best.summary,
            matchScore: Number(bestScore.toFixed(3)),
          });
        }
      }
    } catch (err) {
      console.error("Google Books error:", err);
    }

    // ---------- Open Library fallback ----------
    try {
      let q = rawTitle;
      if (rawAuthor) q = `${rawTitle} ${rawAuthor}`;

      const olUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(
        q,
      )}&limit=20`;

      const olResp = await fetch(olUrl);

      if (olResp.ok) {
        const ol: any = await olResp.json();
        const docs = Array.isArray(ol?.docs) ? ol.docs : [];

        const scored = docs
          .map((doc: any) => {
            const candTitle = String(doc?.title || "").trim();
            const candAuthor = Array.isArray(doc?.author_name)
              ? String(doc.author_name[0] || "").trim()
              : "";
            const key = String(doc?.key || "").trim();
            const s = candTitle ? totalScore(candTitle, candAuthor) : 0;
            const aScore = scoreAuthor(candAuthor);

            return { candTitle, candAuthor, key, s, aScore };
          })
          .filter((x: any) => x.key && x.candTitle)
          .sort((a: any, b: any) => b.s - a.s)
          .slice(0, 8);

        if (!scored.length) {
          return res.status(404).json({
            error: "No results found. Try checking the title spelling.",
          });
        }

        if (scored[0].s < PASS_THRESHOLD) {
          return res.status(404).json({
            error: "No strong match found.",
          });
        }

        for (const cand of scored) {
          if (rawAuthor && cand.aScore < MIN_AUTHOR_IF_PROVIDED) continue;

          const workUrl = `https://openlibrary.org${cand.key}.json`;
          const workResp = await fetch(workUrl);

          if (!workResp.ok) continue;

          const work: any = await workResp.json();
          const desc = work?.description;

          const summary =
            typeof desc === "string"
              ? desc
              : typeof desc?.value === "string"
                ? desc.value
                : "";

          if (summary && summary.trim()) {
            return res.json({
              source: "open_library",
              title: cand.candTitle || rawTitle,
              author: cand.candAuthor || rawAuthor,
              summary: summary.trim(),
              matchScore: Number(cand.s.toFixed(3)),
            });
          }
        }
      }
    } catch (err) {
      console.error("Open Library error:", err);
    }

    return res.status(404).json({
      error: "No summary found.",
    });
  } catch (err) {
    console.error("Summary endpoint error:", err);
    return res.status(500).json({ error: "Failed to fetch summary" });
  }
});

export default router;
