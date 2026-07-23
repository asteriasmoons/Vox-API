const DEFAULT_RECOMMENDATION_BOOK_SUMMARY_GEMINI_MODEL = "gemini-2.5-flash";

export function recommendationBookSummaryGeminiModel(): string {
  return (
    process.env.GEMINI_BOOK_SUMMARY_MODEL ||
    process.env.GEMINI_MODEL ||
    DEFAULT_RECOMMENDATION_BOOK_SUMMARY_GEMINI_MODEL
  );
}
