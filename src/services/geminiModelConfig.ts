const DEFAULT_RECOMMENDATION_BOOK_SUMMARY_GEMINI_MODEL = "gemini-3.6-flash";

export function recommendationBookSummaryGeminiModel(): string {
  return (
    process.env.GEMINI_BOOK_SUMMARY_MODEL ||
    DEFAULT_RECOMMENDATION_BOOK_SUMMARY_GEMINI_MODEL
  );
}

export function recommendationBookSummaryGeminiFallbackModels(): string[] {
  return [
    DEFAULT_RECOMMENDATION_BOOK_SUMMARY_GEMINI_MODEL,
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ];
}
