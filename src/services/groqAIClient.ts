const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "groq/compound";
const GROQ_TIMEOUT_MS = 30_000;
const GROQ_RETRIES = 2;

type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GroqChatOptions = {
  stage: string;
  temperature: number;
  maxTokens: number;
  model?: string;
  responseFormat?: "json_object" | "text";
};

type GroqChatResponse = {
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
    return cleanText(record.message) || cleanText(record.type) || "Groq error";
  }

  return cleanText(body?.message) || "Groq error";
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

async function groqChat(
  systemPrompt: string,
  userPrompt: string,
  options: GroqChatOptions,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  const model = options.model ?? process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= GROQ_RETRIES; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    try {
      console.log("[dotti:groq] request", {
        stage: options.stage,
        model,
        attempt: attempt + 1,
      });

      const messages: GroqMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          ...(options.responseFormat !== "text"
            ? { response_format: { type: "json_object" } }
            : {}),
          messages,
        }),
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => null)) as
        | GroqChatResponse
        | ProviderErrorBody
        | null;
      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        const message = safeErrorMessage(json as ProviderErrorBody | null);
        console.error("[dotti:groq] failure", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          status: response.status,
          transient: isTransientStatus(response.status),
          message,
        });

        const error = new Error(
          `Groq ${options.stage} failed with HTTP ${response.status}: ${message}`,
        );
        lastError = error;

        if (!isTransientStatus(response.status) || attempt >= GROQ_RETRIES) {
          throw error;
        }

        await sleep(retryAfterDelayMs(response, attempt));
        continue;
      }

      const content = cleanText(
        contentToText((json as GroqChatResponse | null)?.choices?.[0]?.message?.content),
      );
      console.log("[dotti:groq] success", {
        stage: options.stage,
        model,
        attempt: attempt + 1,
        durationMs,
        promptTokens: (json as GroqChatResponse | null)?.usage?.prompt_tokens,
        completionTokens:
          (json as GroqChatResponse | null)?.usage?.completion_tokens,
        totalTokens: (json as GroqChatResponse | null)?.usage?.total_tokens,
      });

      return content;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      lastError = error;

      if (isAbortError(error)) {
        console.error("[dotti:groq] timeout", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          timeoutMs: GROQ_TIMEOUT_MS,
        });
      } else if (!(error instanceof Error && error.message.startsWith("Groq "))) {
        console.error("[dotti:groq] failure", {
          stage: options.stage,
          model,
          attempt: attempt + 1,
          durationMs,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (attempt >= GROQ_RETRIES) break;
      if (error instanceof Error && error.message.startsWith("Groq ")) break;
      await sleep(Math.min(750 * 2 ** attempt, 8_000));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (isAbortError(lastError)) {
    throw new Error(
      `Groq ${options.stage} timed out after ${GROQ_TIMEOUT_MS / 1000}s`,
    );
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function groqChatJson(
  systemPrompt: string,
  userPrompt: string,
  options: GroqChatOptions,
): Promise<string> {
  return groqChat(systemPrompt, userPrompt, {
    ...options,
    responseFormat: "json_object",
  });
}

export async function groqChatText(
  systemPrompt: string,
  userPrompt: string,
  options: GroqChatOptions,
): Promise<string> {
  return groqChat(systemPrompt, userPrompt, {
    ...options,
    responseFormat: "text",
  });
}
