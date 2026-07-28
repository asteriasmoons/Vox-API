//
//  regularRecsGroq.ts
//  Groq JSON chat helper for the REGULAR recommendation engine.
//

import {
  REGULAR_GROQ_CHAT_COMPLETIONS_URL,
  REGULAR_GROQ_MODEL,
  REGULAR_GROQ_TIMEOUT_MS,
} from "./regularRecsConfig";
import { cleanText, fetchWithRetry } from "./regularRecsUtils";
import type { RegularGroqChatResponse } from "./regularRecsTypes";

function regularGroqApiKeys(): string[] {
  return [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_ALT]
    .map((key) => cleanText(key))
    .filter(Boolean);
}

export async function regularGroqChatJson(
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  const keys = regularGroqApiKeys();
  if (keys.length === 0) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  let lastDetail = "";

  for (const apiKey of keys) {
    const response = await fetchWithRetry(
      REGULAR_GROQ_CHAT_COMPLETIONS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: REGULAR_GROQ_MODEL,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      },
      REGULAR_GROQ_TIMEOUT_MS,
      "Groq",
    );

    if (response.ok) {
      const json = (await response
        .json()
        .catch(() => null)) as RegularGroqChatResponse | null;
      return cleanText(json?.choices?.[0]?.message?.content);
    }

    lastDetail = `Groq responded ${response.status}`;
    if (response.status !== 401 && response.status !== 403) break;
    console.warn("Groq auth failed on a key; trying alternate key if available");
  }

  throw new Error(lastDetail || "Groq request failed");
}
