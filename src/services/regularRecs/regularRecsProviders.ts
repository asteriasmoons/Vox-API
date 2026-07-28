//
//  regularRecsProviders.ts
//  Mistral + OpenRouter chat clients for the REGULAR engine.
//  (Groq lives in regularRecsGroq.ts.) Self-contained; no collection code.
//
//  These let the engine spread candidate generation across three providers in
//  parallel so no single provider's per-minute token limit is a bottleneck.
//

import { REGULAR_GROQ_TIMEOUT_MS } from "./regularRecsConfig";
import { cleanText, fetchWithRetry } from "./regularRecsUtils";

const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const CEREBRAS_CHAT_URL = "https://api.cerebras.ai/v1/chat/completions";

export const REGULAR_MISTRAL_MODEL =
  process.env.MISTRAL_MODEL || "mistral-small-latest";
export const REGULAR_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";
export const REGULAR_CEREBRAS_MODEL =
  process.env.CEREBRAS_MODEL || "gpt-oss-120b";

interface ProviderChatResponse {
  choices?: Array<{ message?: { content?: unknown } | null }>;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((chunk) => {
      if (typeof chunk === "string") return chunk;
      if (!chunk || typeof chunk !== "object") return "";
      const record = chunk as Record<string, unknown>;
      return cleanText(record.text) || cleanText(record.content);
    })
    .filter(Boolean)
    .join("");
}

async function providerChatJson(
  url: string,
  apiKey: string,
  model: string,
  label: string,
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; maxTokens: number },
  extraBody: Record<string, unknown> = {},
): Promise<string> {
  if (!apiKey) throw new Error(`Missing API key for ${label}`);

  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        response_format: { type: "json_object" },
        ...extraBody,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    REGULAR_GROQ_TIMEOUT_MS,
    label,
  );

  if (!response.ok) {
    throw new Error(`${label} responded ${response.status}`);
  }
  const json = (await response.json().catch(() => null)) as ProviderChatResponse | null;
  return cleanText(contentToText(json?.choices?.[0]?.message?.content));
}

export async function regularMistralChatJson(
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  return providerChatJson(
    MISTRAL_CHAT_URL,
    cleanText(process.env.MISTRAL_API_KEY),
    REGULAR_MISTRAL_MODEL,
    "Mistral",
    systemPrompt,
    userPrompt,
    options,
  );
}

export async function regularOpenRouterChatJson(
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  return providerChatJson(
    OPENROUTER_CHAT_URL,
    cleanText(process.env.OPENROUTER_API_KEY),
    REGULAR_OPENROUTER_MODEL,
    "OpenRouter",
    systemPrompt,
    userPrompt,
    options,
  );
}

export async function regularCerebrasChatJson(
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  // gpt-oss on Cerebras is a reasoning model; keep reasoning minimal.
  const extraBody = REGULAR_CEREBRAS_MODEL.includes("gpt-oss")
    ? { reasoning_effort: "low" }
    : {};
  return providerChatJson(
    CEREBRAS_CHAT_URL,
    cleanText(process.env.CEREBRAS_API_KEY),
    REGULAR_CEREBRAS_MODEL,
    "Cerebras",
    systemPrompt,
    userPrompt,
    options,
    extraBody,
  );
}
