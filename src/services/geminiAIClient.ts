import { recommendationBookSummaryGeminiModel } from "./geminiModelConfig";

const GEMINI_GENERATE_CONTENT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_TIMEOUT_MS = 30_000;
const GEMINI_RETRIES = 2;

type GeminiJsonOptions = {
  stage: string;
  temperature: number;
  maxOutputTokens: number;
  model?: string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: unknown;
      }>;
    };
    finishReason?: unknown;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

type ProviderErrorBody = {
  error?: unknown;
  message?: unknown;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function contentToText(response: GeminiGenerateContentResponse | null): string {
  return (response?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => cleanText(part.text))
    .filter(Boolean)
    .join("");
}

function safeErrorMessage(body: ProviderErrorBody | null): string {
  const error = body?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return cleanText(record.message) || cleanText(record.status) || "Gemini error";
  }

  return cleanText(body?.message) || "Gemini error";
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

export async function geminiGenerateJson(
  systemPrompt: string,
  userPrompt: string,
  options: GeminiJsonOptions,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY environment variable");
  }

  const model = options.model ?? recommendationBookSummaryGeminiModel();
  const url = new URL(
    `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(model)}:generateContent`,
  );
  url.searchParams.set("key", apiKey);

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= GEMINI_RETRIES; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    try {
      console.log("[recommendation-book-detail:gemini] request", {
        stage: options.stage,
        model,
        attempt: attempt + 1,
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxOutputTokens,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => null)) as
        | GeminiGenerateContentResponse
        | ProviderErrorBody
        | null;
      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        const message = safeErrorMessage(json as ProviderErrorBody | null);
        console.error("[recommendation-book-detail:gemini] failure", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          status: response.status,
          transient: isTransientStatus(response.status),
          message,
        });

        const error = new Error(
          `Gemini ${options.stage} failed with HTTP ${response.status}: ${message}`,
        );
        lastError = error;

        if (!isTransientStatus(response.status) || attempt >= GEMINI_RETRIES) {
          throw error;
        }

        await sleep(retryAfterDelayMs(response, attempt));
        continue;
      }

      const content = cleanText(contentToText(json as GeminiGenerateContentResponse | null));
      console.log("[recommendation-book-detail:gemini] success", {
        stage: options.stage,
        model,
        attempt: attempt + 1,
        durationMs,
        finishReason: (json as GeminiGenerateContentResponse | null)?.candidates?.[0]
          ?.finishReason,
        promptTokens: (json as GeminiGenerateContentResponse | null)?.usageMetadata
          ?.promptTokenCount,
        completionTokens: (json as GeminiGenerateContentResponse | null)?.usageMetadata
          ?.candidatesTokenCount,
        totalTokens: (json as GeminiGenerateContentResponse | null)?.usageMetadata
          ?.totalTokenCount,
      });

      return content;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      lastError = error;

      if (isAbortError(error)) {
        console.error("[recommendation-book-detail:gemini] timeout", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          timeoutMs: GEMINI_TIMEOUT_MS,
        });
      } else if (!(error instanceof Error && error.message.startsWith("Gemini "))) {
        console.error("[recommendation-book-detail:gemini] failure", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (attempt >= GEMINI_RETRIES) break;
      if (error instanceof Error && error.message.startsWith("Gemini ")) break;
      await sleep(Math.min(750 * 2 ** attempt, 8_000));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (isAbortError(lastError)) {
    throw new Error(
      `Gemini ${options.stage} timed out after ${GEMINI_TIMEOUT_MS / 1000}s`,
    );
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
