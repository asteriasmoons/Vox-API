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
      console.error("[grocery-price] GROQ_API_KEY is missing");
      return res.status(500).json({ error: "Missing GROQ_API_KEY" });
    }

    const { ingredient, store, quantity } = req.body as PriceLookupRequest;
    console.log(`[grocery-price] Request: ingredient="${ingredient}" store="${store}" quantity=${quantity}`);

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
            role: "user",
            content: `Search ${domain} for "${ingredient}". Return ONLY a JSON array of products with prices, no other text: [{"price": 3.49, "name": "Product Name"}]. Max 5 results. If none found return [].`,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
        search_settings: {
          include_domains: [domain],
          country: "united states",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[grocery-price] Groq API error: ${response.status} ${errText}`);
      return res.status(502).json({ error: "Price lookup failed", status: response.status, detail: errText });
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    const content = data.choices?.[0]?.message?.content?.trim() || "";
    console.log(`[grocery-price] Groq response status: ${response.status}`);
    console.log(`[grocery-price] Groq raw content: ${content}`);

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

    console.log(`[grocery-price] Parsed ${results.length} results`);
    if (results.length > 0 && results[0]) {
      console.log(`[grocery-price] First result: ${results[0].name} @ ${results[0].price}`);
    }

    return res.json({
      results: results.slice(0, 5),
      ingredient,
      store: storeName,
      quantity,
    });
  } catch (error) {
    console.error("[grocery-price] Unhandled error:", error);
    return res.status(500).json({ error: "Internal server error", detail: String(error) });
  }
});

export default router;
