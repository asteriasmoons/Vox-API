export function catalogLog(event: string, fields: Record<string, unknown> = {}, traceID?: string): void {
  console.info("[LoomeyCatalog]", JSON.stringify({ time: new Date().toISOString(), event, traceID: traceID ?? "background", ...fields }));
}

export function catalogFailure(error: unknown): Record<string, unknown> {
  const value = error as { name?: string; code?: string; status?: number };
  return { code: value?.code ?? "UNAVAILABLE", name: value?.name ?? "Error", status: value?.status };
}

export function providerRequestFields(url: URL): Record<string, unknown> {
  const parameters = Object.fromEntries([...url.searchParams].map(([name, value]) => [name,
    ["searchQuery", "isbn", "continuationToken", "apiKey"].includes(name) ? "[redacted]" : value]));
  return { path: url.pathname, parameters };
}
