const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";

export function recommendationMistralModel(): string {
  return process.env.MISTRAL_MODEL || DEFAULT_MISTRAL_MODEL;
}

