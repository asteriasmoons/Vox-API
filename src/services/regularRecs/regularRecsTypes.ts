//
//  regularRecsTypes.ts
//  Shared types & enums for the REGULAR (books-like-this / reading-request)
//  recommendation engine. Not used by collections/shelves.
//

export const REGULAR_REQUEST_TYPES = [
  "specific_book",
  "author",
  "genre",
  "subgenre",
  "trope",
  "mood",
  "natural_language",
] as const;
export type RegularRequestType = (typeof REGULAR_REQUEST_TYPES)[number];

export function isRegularRequestType(value: string): value is RegularRequestType {
  return (REGULAR_REQUEST_TYPES as readonly string[]).includes(value);
}

export const REGULAR_CANDIDATE_GROUPS = [
  "closest",
  "reader_safe",
  "hidden_gem",
  "recent_release",
  "backlist",
  "adjacent",
] as const;
export type RegularCandidateGroup = (typeof REGULAR_CANDIDATE_GROUPS)[number];

export const REGULAR_CANDIDATE_GROUP_LABEL: Record<RegularCandidateGroup, string> = {
  closest: "Closest match",
  reader_safe: "Reader favorite",
  hidden_gem: "Hidden gem",
  recent_release: "Recent release",
  backlist: "Backlist pick",
  adjacent: "You might also like",
};

// Relevance bonus applied by originating candidate group.
export const REGULAR_CANDIDATE_GROUP_BONUS: Record<RegularCandidateGroup, number> = {
  closest: 40,
  reader_safe: 30,
  hidden_gem: 22,
  recent_release: 20,
  backlist: 20,
  adjacent: 12,
};

export const REGULAR_CANDIDATE_GROUP_BRIEF: Record<RegularCandidateGroup, string> = {
  closest:
    "Books that are the closest possible match in genre, subgenre, tone, audience, themes, pacing and tropes.",
  reader_safe:
    "Reliable, well-known, widely loved books that still closely match the request.",
  hidden_gem:
    "Less obvious, under-the-radar books that are still a strong match for the request.",
  recent_release:
    "Strongly relevant books published primarily within the last 5 years.",
  backlist:
    "Older books (more than 5 years old) that remain highly relevant to the request.",
  adjacent:
    "Books that differ slightly in one dimension while still fitting the reader's likely taste.",
};

export interface RegularRequestProfile {
  requestType: RegularRequestType;
  primaryGenres: string[];
  subgenres: string[];
  audience: string;
  tone: string[];
  moods: string[];
  pacing: string[];
  themes: string[];
  tropes: string[];
  romanceLevel: string;
  darknessLevel: string;
  preferredPublicationEra: string;
  keywords: string[];
  excludeKeywords: string[];
}

export interface RegularSeedBook {
  title: string;
  author: string;
  subjects: string[];
  description: string;
  releaseYear?: number | undefined;
  source?: string | undefined;
}

export interface RegularAiCandidate {
  title: string;
  author: string;
  reason?: string | undefined;
  matchTags: string[];
  candidateGroup: RegularCandidateGroup;
}

export interface RegularBookRec {
  title: string;
  subtitle?: string | undefined;
  author: string;
  summary: string;
  coverUrl?: string | undefined;
  pages?: number | undefined;
  releaseYear?: number | undefined;
  publishedDate?: string | undefined;
  rating?: number | undefined;
  ratingsCount?: number | undefined;
  isbn10?: string | undefined;
  isbn13?: string | undefined;
  genres: string[];
  subjects: string[];
  tags: string[];
  matchTags: string[];
  recommendationReason?: string | undefined;
  candidateGroup?: RegularCandidateGroup | undefined;
  // Frontend-facing aliases (LumeyBookRecommendation decodes these):
  strategy?: string | undefined;
  strategyLabel?: string | undefined;
  rationale?: string | undefined;
  source?: string | undefined;
  matchScore: number;
  metadataScore: number;
  finalScore: number;
}

export interface RegularGoogleVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publishedDate?: string;
  pageCount?: number;
  categories?: string[];
  averageRating?: number;
  ratingsCount?: number;
  language?: string;
  printType?: string;
  maturityRating?: string;
  industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
  imageLinks?: { thumbnail?: string; smallThumbnail?: string };
}

export interface RegularGoogleBooksResponse {
  items?: Array<{ volumeInfo?: RegularGoogleVolumeInfo }>;
}

export interface RegularOpenLibraryDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  subject?: string[];
  isbn?: string[];
  language?: string[];
}

export interface RegularOpenLibrarySearchResponse {
  docs?: RegularOpenLibraryDoc[];
}

export interface RegularGroqChatResponse {
  choices?: Array<{ message?: { content?: string | null } | null }>;
}

export interface RegularBuildResult {
  recs: RegularBookRec[];
  profile: RegularRequestProfile;
  seed: RegularSeedBook | null;
  generatedCount: number;
  verifiedCount: number;
}
