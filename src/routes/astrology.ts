import { Router } from "express";

const router = Router();

const OHMANDA_URL = "https://ohmanda.com/api/horoscope";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";

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

type HoroscopePayload = {
  sign: string;
  message: string;
  date: string;
  source: "ohmanda" | "groq";
};

function normalizeSign(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase();
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function fetchOhmandaHoroscope(sign: string): Promise<HoroscopePayload> {
  const today = todayISODate();
  const url = `${OHMANDA_URL}/${encodeURIComponent(sign)}`;

  const response = await fetch(url, {
    method: "GET",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      text || response.statusText || "Ohmanda horoscope provider failed",
    );
  }

  const data: any = await response.json();
  const horoscope = String(data?.horoscope || "").trim();

  if (!horoscope) {
    throw new Error("Ohmanda horoscope provider returned an empty horoscope");
  }

  return {
    sign: String(data?.sign || sign).toLowerCase(),
    message: horoscope,
    date: String(data?.date || today),
    source: "ohmanda",
  };
}

async function generateGroqHoroscope(sign: string): Promise<HoroscopePayload> {
  const apiKey = process.env.GROQ_API_KEY || "";
  const today = todayISODate();

  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You write original daily horoscope messages for a cozy wellness app. Do not mention that you are an AI. Do not copy, quote, reference, summarize, or imitate any existing horoscope source. Write one grounded, warm, mystical paragraph. Keep it practical, emotionally supportive, and non-medical. Do not make guaranteed predictions. Do not include markdown, headings, bullets, citations, or disclaimers.",
        },
        {
          role: "user",
          content: `Write today's original daily horoscope for ${sign} for ${today}. Make it one complete paragraph, around 80 to 130 words.`,
        },
      ],
      temperature: 0.85,
      max_tokens: 220,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      text || response.statusText || "Groq horoscope generation failed",
    );
  }

  const data: any = await response.json();
  const message = String(data?.choices?.[0]?.message?.content || "").trim();

  if (!message) {
    throw new Error("Groq returned an empty horoscope");
  }

  return {
    sign,
    message,
    date: today,
    source: "groq",
  };
}

// POST /api/astrology/horoscope
router.post("/horoscope", async (req, res) => {
  const rawSign = String(req.body?.sign || "");
  const sign = normalizeSign(rawSign);

  if (!sign) {
    return res.status(400).json({ error: "Sign is required" });
  }

  if (!VALID_SIGNS.has(sign)) {
    return res.status(400).json({ error: "Invalid zodiac sign" });
  }

  try {
    const horoscope = await fetchOhmandaHoroscope(sign);
    return res.json(horoscope);
  } catch (ohmandaError) {
    console.warn("[Horoscope] Ohmanda failed. Trying Groq fallback.", {
      sign,
      error: readableError(ohmandaError),
    });
  }

  try {
    const horoscope = await generateGroqHoroscope(sign);
    return res.json(horoscope);
  } catch (groqError) {
    console.error("[Horoscope] Groq fallback failed.", {
      sign,
      error: readableError(groqError),
    });

    return res.status(502).json({
      error: "Failed to fetch horoscope",
      details: readableError(groqError),
    });
  }
});

export default router;
