import { catalogLog } from "../catalogDiagnostics";
import { hash } from "./normalization";
import { cached, pause, RecommendationStore } from "./repository";
import { ProviderContext, ProviderName, RecommendationError } from "./types";

export type RequestPolicy = { provider: ProviderName; origin: string; intervalMs: number; dailyLimit: number; timeoutMs: number; headers?: Record<string, string> };
export class ProviderTransport {
  private inFlight = new Map<string, Promise<any>>();
  constructor(private store: RecommendationStore, private fetcher: typeof fetch = fetch) {}

  async json(policy: RequestPolicy, url: URL, context: ProviderContext, body?: unknown, ttl = 6 * 3600000): Promise<any> {
    if (url.origin !== policy.origin || url.protocol !== "https:" || url.username || url.password) throw new RecommendationError("INVALID_PROVIDER_URL", 502);
    const key = `provider-v1:${policy.provider}:${hash(JSON.stringify([url.href, body, policy.headers?.Authorization ?? ""]))}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = cached(this.store, key, ttl, context.signal, () => this.send(policy, url, context, body));
    this.inFlight.set(key, pending);
    try { return await pending; } finally { this.inFlight.delete(key); }
  }

  private async send(policy: RequestPolicy, url: URL, context: ProviderContext, body?: unknown) {
    const blocked = await this.store.get<number>(`blocked:${policy.provider}`);
    if (blocked && blocked > Date.now()) throw new RecommendationError("PROVIDER_RATE_LIMITED", 429, Math.ceil((blocked - Date.now()) / 1000));
    for (let attempt = 0; attempt < 2; attempt++) {
      let current = url;
      try {
        for (let redirect = 0; redirect < 3; redirect++) {
          if (context.budgets) {
            const remaining = context.budgets[policy.provider] ?? 0;
            if (remaining <= 0) throw new RecommendationError("PROVIDER_JOB_BUDGET_EXHAUSTED", 429, 300);
            context.budgets[policy.provider] = remaining - 1;
          }
          await this.store.reserve(policy.provider, policy.intervalMs, policy.dailyLimit, context.signal);
          context.signal.throwIfAborted();
          const started = Date.now();
          catalogLog("engine.provider_request", { provider: policy.provider, host: current.hostname, path: current.pathname, request: hash(url.href + JSON.stringify(body)).slice(0, 12), attempt: attempt + 1 }, context.traceID);
          const response = await this.fetcher(current, { method: body === undefined ? "GET" : "POST", redirect: "manual",
            headers: { Accept: "application/json", "User-Agent": "Loomey/1.0 (book discovery)", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...policy.headers },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([context.signal, AbortSignal.timeout(policy.timeoutMs)]) });
          catalogLog("engine.provider_response", { provider: policy.provider, status: response.status, elapsedMs: Date.now() - started }, context.traceID);
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("Location");
            const target = location ? new URL(location, current) : null;
            if (!target || target.origin !== policy.origin || target.protocol !== "https:" || target.username || target.password) throw new RecommendationError("UNSAFE_PROVIDER_REDIRECT", 502);
            current = target;
            continue;
          }
          if (response.status === 404) return null;
          if ([401, 403].includes(response.status)) {
            await this.store.set(`blocked:${policy.provider}`, Date.now() + 300000, 300000);
            throw new RecommendationError("PROVIDER_ACCESS_DENIED", response.status);
          }
          if (response.status === 429) {
            const raw = response.headers.get("Retry-After") ?? "60";
            const seconds = Math.max(1, Math.min(86400, Number(raw) || Math.ceil((Date.parse(raw) - Date.now()) / 1000) || 60));
            await this.store.set(`blocked:${policy.provider}`, Date.now() + seconds * 1000, seconds * 1000);
            throw new RecommendationError("PROVIDER_RATE_LIMITED", 429, seconds);
          }
          if (!response.ok) throw new RecommendationError(response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_REJECTED", response.status >= 500 ? 503 : 502);
          const raw = await response.text();
          if (raw.length > 4 * 1024 * 1024) throw new RecommendationError("INVALID_PROVIDER_RESPONSE", 502);
          try { return JSON.parse(raw); } catch { throw new RecommendationError("INVALID_PROVIDER_RESPONSE", 502); }
        }
        throw new RecommendationError("UNSAFE_PROVIDER_REDIRECT", 502);
      } catch (error: any) {
        context.signal.throwIfAborted();
        const cause = String(error?.cause?.code ?? error?.code ?? "");
        const tls = /CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(cause);
        const code = tls ? "PROVIDER_TLS_FAILED" : error instanceof RecommendationError ? error.code : error?.name === "TimeoutError" ? "PROVIDER_TIMED_OUT" : "PROVIDER_UNAVAILABLE";
        context.failures?.add(policy.provider);
        catalogLog("engine.provider_failed", { provider: policy.provider, host: current.hostname, path: current.pathname, code, cause, attempt: attempt + 1 }, context.traceID);
        if (attempt || !["PROVIDER_UNAVAILABLE", "PROVIDER_TIMED_OUT"].includes(code)) throw error instanceof RecommendationError ? error : new RecommendationError(code);
        await pause(300, context.signal);
      }
    }
    throw new RecommendationError("PROVIDER_UNAVAILABLE");
  }
}
