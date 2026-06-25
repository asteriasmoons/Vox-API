export type LumeyChallengeValidationStatus =
  | "approved"
  | "needsMoreInfo"
  | "rejected";

export interface LumeyThemeValidationBook {
  title: string;
  author?: string;
  summary?: string;
  genres?: string[];
  moods?: string[];
  tags?: string[];
  tropes?: string[];
  topics?: string[];
}

export interface LumeyThemeValidationRequest {
  challengeTitle: string;
  requirementText: string;
  requiredThemes: string[];
  books: LumeyThemeValidationBook[];
  submissionNote?: string;
  reviewText?: string;
}

export interface LumeyThemeValidationResponse {
  result: LumeyChallengeValidationStatus;
  message: string;
}

export function isLumeyThemeValidationRequest(
  value: unknown,
): value is LumeyThemeValidationRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Record<string, unknown>;

  return (
    typeof body.challengeTitle === "string" &&
    typeof body.requirementText === "string" &&
    Array.isArray(body.requiredThemes) &&
    Array.isArray(body.books)
  );
}

export function validateLumeyThemeValidationRequest(value: unknown): {
  valid: boolean;
  message?: string;
} {
  if (!isLumeyThemeValidationRequest(value)) {
    return {
      valid: false,
      message: "The request body is missing required fields.",
    };
  }

  if (value.challengeTitle.trim().length === 0) {
    return {
      valid: false,
      message: "Challenge title is required.",
    };
  }

  if (value.requirementText.trim().length === 0) {
    return {
      valid: false,
      message: "Challenge requirement is required.",
    };
  }

  if (value.books.length === 0) {
    return {
      valid: false,
      message: "At least one linked book is required.",
    };
  }

  for (const book of value.books) {
    if (!book.title || book.title.trim().length === 0) {
      return {
        valid: false,
        message: "Every linked book must have a title.",
      };
    }
  }

  return {
    valid: true,
  };
}
