import { Router } from "express";

const router = Router();

const OHMANDA_URL = "https://ohmanda.com/api/horoscope";

const VALID_SIGNS = new Set([
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
]);

function normalizeSign(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase();
}

// POST /api/astrology/horoscope
router.post("/horoscope", async (req, res) => {
  try {
    const rawSign = String(req.body?.sign || "");
    const sign = normalizeSign(rawSign);

    if (!sign) {
      return res.status(400).json({ error: "Sign is required" });
    }

    if (!VALID_SIGNS.has(sign)) {
      return res.status(400).json({ error: "Invalid zodiac sign" });
    }

    const url = `${OHMANDA_URL}/${encodeURIComponent(sign)}`;

    const response = await fetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return res.status(502).json({
        error: "Failed to fetch horoscope from provider",
        details: text || response.statusText,
      });
    }

    const data: any = await response.json();

    const horoscope = String(data?.horoscope || "").trim();

    if (!horoscope) {
      return res.status(502).json({
        error: "Horoscope provider returned an empty horoscope",
        details: data,
      });
    }

    return res.json({
      sign: data?.sign || sign,
      message: horoscope,
      date: data?.date || null,
    });
  } catch (error) {
    console.error("Astrology horoscope error:", error);
    return res.status(500).json({ error: "Failed to fetch horoscope" });
  }
});

export default router;
