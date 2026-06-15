import { Router } from "express";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "compound-beta";

interface PriceLookupRequest {
  ingredient: string;
  store: string;
  quantity: number;
}

const STORE_DOMAINS: Record<string, string> = {
  walmart: "walmart.com",
  amazon: "amazon.com",
  publix: "publix.com",
  kroger: "kroger.com",
};

const router = Router();

router.post("/", async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GROQ_API_KEY" });
    }

    const { ingredient, store, quantity } = req.body as PriceLookupRequest;

    if (!ingredient || !store) {
      return res.status(400).json({ error: "Missing ingredient or store" });
    }

    const domain = STORE_DOMAINS[store.toLowerCase()];
    if (!domain) {
      return res
        .status(400)
        .json({ error: "Unsupported store. Use: walmart, amazon, publix, kroger" });
    }

    const storeName =
      store.charAt(0).toUpperCase() + store.slice(1).toLowerCase();

    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `You are a grocery price lookup assistant. When asked about a product at a specific store, search for it and respond with ONLY a JSON array of up to 5 matching products in this exact format: [{"price": 3.49, "name": "Great Value Hamburger Buns 8ct"}, {"price": 4.29, "name": "Sara Lee Brioche Buns 8ct"}]. Each price should be the shelf price in USD as a number. If no results are found, respond: []. Do NOT include any other text, explanation, or markdown.`,
          },
          {
            role: "user",
            content: `Search for ${ingredient} at ${storeName}. Show me the available options with prices.`,
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
        search_settings: {
          include_domains: [domain],
          country: "united states",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", response.status, errText);
      return res.status(502).json({ error: "Price lookup failed" });
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    const content = data.choices?.[0]?.message?.content?.trim() || "";

    let results: { price: number; name: string }[] = [];

    try {
      const cleaned = content.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item.price === "number" && item.price > 0 && item.name) {
            results.push({ price: item.price, name: item.name });
          }
        }
      }
    } catch {
      const matches = content.matchAll(/"name"\s*:\s*"([^"]+)".*?"price"\s*:\s*(\d+\.?\d*)/g);
      for (const m of matches) {
        if (m[1] && m[2]) {
          results.push({ name: m[1], price: parseFloat(m[2]) });
        }
      }
    }

    return res.json({
      results: results.slice(0, 5),
      ingredient,
      store: storeName,
      quantity,
    });
  } catch (error) {
    console.error("Price lookup error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
