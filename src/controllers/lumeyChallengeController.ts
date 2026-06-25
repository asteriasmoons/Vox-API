import { Request, Response } from "express";
import { validateChallengeTheme } from "../services/challengeThemeValidationService";

type ChallengeValidationStatus = "approved" | "needsMoreInfo" | "rejected";

interface ThemeValidationBook {
  title: string;
  author?: string;
  summary?: string;
  genres?: string[];
  moods?: string[];
  tags?: string[];
  tropes?: string[];
  topics?: string[];
}

interface ValidateThemeRequestBody {
  challengeTitle: string;
  requirementText: string;
  requiredThemes: string[];
  books: ThemeValidationBook[];
  submissionNote?: string;
  reviewText?: string;
}

interface ValidateThemeResponseBody {
  result: ChallengeValidationStatus;
  message: string;
}

export async function validateLumeyChallengeTheme(
  req: Request<{}, ValidateThemeResponseBody, ValidateThemeRequestBody>,
  res: Response<ValidateThemeResponseBody>,
) {
  try {
    const {
      challengeTitle,
      requirementText,
      requiredThemes,
      books,
      submissionNote,
      reviewText,
    } = req.body;

    if (!challengeTitle || typeof challengeTitle !== "string") {
      return res.status(400).json({
        result: "needsMoreInfo",
        message: "Challenge title is required.",
      });
    }

    if (!requirementText || typeof requirementText !== "string") {
      return res.status(400).json({
        result: "needsMoreInfo",
        message: "Challenge requirement is required.",
      });
    }

    if (!Array.isArray(requiredThemes)) {
      return res.status(400).json({
        result: "needsMoreInfo",
        message: "Required themes must be provided as a list.",
      });
    }

    if (!Array.isArray(books) || books.length === 0) {
      return res.status(400).json({
        result: "needsMoreInfo",
        message: "At least one linked book is required for theme validation.",
      });
    }

    const cleanedBooks = books
      .filter((book) => book && typeof book.title === "string")
      .map((book) => ({
        title: book.title.trim(),
        author: book.author?.trim() ?? "",
        summary: book.summary?.trim() ?? "",
        genres: cleanStringArray(book.genres),
        moods: cleanStringArray(book.moods),
        tags: cleanStringArray(book.tags),
        tropes: cleanStringArray(book.tropes),
        topics: cleanStringArray(book.topics),
      }))
      .filter((book) => book.title.length > 0);

    if (cleanedBooks.length === 0) {
      return res.status(400).json({
        result: "needsMoreInfo",
        message:
          "Linked books need valid titles before Lumey can validate the theme.",
      });
    }

    const validationResult = await validateChallengeTheme({
      challengeTitle: challengeTitle.trim(),
      requirementText: requirementText.trim(),
      requiredThemes: cleanStringArray(requiredThemes),
      books: cleanedBooks,
      submissionNote: submissionNote?.trim() ?? "",
      reviewText: reviewText?.trim() ?? "",
    });

    return res.status(200).json({
      result: validationResult.result,
      message: validationResult.message,
    });
  } catch (error) {
    console.error("Lumey challenge theme validation failed:", error);

    return res.status(500).json({
      result: "needsMoreInfo",
      message:
        "Lumey could not validate this challenge right now. Please try again soon.",
    });
  }
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
