const DEFAULT_CEREBRAS_MODEL = "llama-3.3-70b";

export function defaultCerebrasModel(): string {
  return process.env.CEREBRAS_MODEL || DEFAULT_CEREBRAS_MODEL;
}
