import { recommendationOpenRouterModel } from "./openRouterModelConfig";

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = 25_000;
const OPENROUTER_RETRIES = 2;

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterChatOptions = {
  stage: string;
  temperature: number;
  maxTokens: number;
  model?: string;
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    } | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type ProviderErrorBody = {
  error?: unknown;
  message?: unknown;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function safeErrorMessage(body: ProviderErrorBody | null): string {
  const error = body?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return cleanText(record.message) || cleanText(record.type) || "OpenRouter error";
  }

  return cleanText(body?.message) || "OpenRouter error";
}

function retryAfterDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return Math.max(500, Math.min(seconds * 1000, 30_000));
    }

    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) {
      return Math.max(500, Math.min(dateMs - Date.now(), 30_000));
    }
  }

  return Math.min(750 * 2 ** attempt, 8_000);
}

function isTransientStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function openRouterChatJson(
  systemPrompt: string,
  userPrompt: string,
  options: OpenRouterChatOptions,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable");
  }

  const model = options.model ?? recommendationOpenRouterModel();
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= OPENROUTER_RETRIES; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      console.log("[recommendations:openrouter] request", {
        stage: options.stage,
        model,
        attempt: attempt + 1,
      });

      const messages: OpenRouterMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
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
          messages,
        }),
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => null)) as
        | OpenRouterChatResponse
        | ProviderErrorBody
        | null;
      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        const message = safeErrorMessage(json as ProviderErrorBody | null);
        console.error("[recommendations:openrouter] failure", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          status: response.status,
          transient: isTransientStatus(response.status),
          message,
        });

        const error = new Error(
          `OpenRouter ${options.stage} failed with HTTP ${response.status}: ${message}`,
        );
        lastError = error;

        if (!isTransientStatus(response.status) || attempt >= OPENROUTER_RETRIES) {
          throw error;
        }

        await sleep(retryAfterDelayMs(response, attempt));
        continue;
      }

      const content = cleanText(
        contentToText((json as OpenRouterChatResponse | null)?.choices?.[0]?.message?.content),
      );
      console.log("[recommendations:openrouter] success", {
        stage: options.stage,
        model,
        attempt: attempt + 1,
        durationMs,
        promptTokens: (json as OpenRouterChatResponse | null)?.usage?.prompt_tokens,
        completionTokens:
          (json as OpenRouterChatResponse | null)?.usage?.completion_tokens,
        totalTokens: (json as OpenRouterChatResponse | null)?.usage?.total_tokens,
      });

      return content;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      lastError = error;

      if (isAbortError(error)) {
        console.error("[recommendations:openrouter] timeout", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          timeoutMs: OPENROUTER_TIMEOUT_MS,
        });
      } else if (!(error instanceof Error && error.message.startsWith("OpenRouter "))) {
        console.error("[recommendations:openrouter] failure", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (attempt >= OPENROUTER_RETRIES) break;
      if (error instanceof Error && error.message.startsWith("OpenRouter ")) break;
      await sleep(Math.min(750 * 2 ** attempt, 8_000));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (isAbortError(lastError)) {
    throw new Error(
      `OpenRouter ${options.stage} timed out after ${OPENROUTER_TIMEOUT_MS / 1000}s`,
    );
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
