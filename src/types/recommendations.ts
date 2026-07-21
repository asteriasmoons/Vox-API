export const RECOMMENDATION_REQUEST_TYPES = [
  "specific_book",
  "author",
  "genre",
  "subgenre",
  "trope",
  "theme",
  "mood",
  "natural_language",
] as const;

export type RecommendationRequestType =
  (typeof RECOMMENDATION_REQUEST_TYPES)[number];

export const RECOMMENDATION_STRATEGIES = [
  "closest_match",
  "reader_safe",
  "hidden_gems",
  "recent_releases",
  "backlist",
  "adjacent_reads",
] as const;

export type RecommendationStrategy = (typeof RECOMMENDATION_STRATEGIES)[number];

export type RecommendationSurface =
  | "route"
  | "home"
  | "similar"
  | "discover"
  | "shelf";

export type RecommendationSource =
  | "Google Books"
  | "Open Library"
  | "Open Library + Google Books";

export type ReaderRecommendationContext = {
  libraryBookKeys?: string[];
  finishedBookKeys?: string[];
  ratings?: Array<{
    title: string;
    author?: string;
    rating: number;
  }>;
  readingSessions?: Array<{
    bookKey: string;
    lastReadAt?: string;
    pagesRead?: number;
    minutesRead?: number;
  }>;
  pagePreferences?: {
    preferredMinPages?: number;
    preferredMaxPages?: number;
  };
  favoriteGenres?: string[];
  favoriteSubgenres?: string[];
  favoriteTropes?: string[];
  favoriteMoods?: string[];
  favoriteThemes?: string[];
  favoriteAuthors?: string[];
  favoriteTags?: string[];
  recentBookKeys?: string[];
  dismissedBookKeys?: string[];
  alreadyRecommendedBookKeys?: string[];
};

export type RecommendationRequest = {
  query: string;
  surface: RecommendationSurface;
  desiredCount: number;
  minVerifiedResults: number;
  requestTypeHint?: RecommendationRequestType;
  seedBook?: SeedBook;
  readerContext?: ReaderRecommendationContext;
  excludeBookKeys?: string[];
};

export type RecommendationIntent = {
  requestType: RecommendationRequestType;
  normalizedQuery: string;
  confidence: number;
  entities: {
    title?: string;
    author?: string;
    genre?: string;
    subgenre?: string;
    trope?: string;
    theme?: string;
    mood?: string;
  };
};

export type SeedBook = {
  title: string;
  author: string;
  subjects: string[];
  description: string;
  releaseYear?: number;
  source?: RecommendationSource;
};

export type RecommendationProfile = {
  requestType: RecommendationRequestType;
  query: string;
  genre: string;
  subgenres: string[];
  tone: string;
  pacing: string;
  audience: string;
  romanceLevel: string;
  darknessLevel: string;
  keyTropes: string[];
  themes: string[];
  moods: string[];
  authors: string[];
  comparableBooks: Array<{
    title: string;
    author?: string;
  }>;
};

export type AiBookCandidate = {
  title: string;
  author?: string;
  summary?: string;
  strategy: RecommendationStrategy;
  rationale?: string;
};

export type CandidateGroup = {
  strategy: RecommendationStrategy;
  label: string;
  candidates: AiBookCandidate[];
};

export type CatalogBookMetadata = {
  title: string;
  author: string;
  summary: string;
  coverUrl?: string;
  pages?: number;
  releaseYear?: number;
  rating?: number;
  tags: string[];
  source: RecommendationSource;
  catalogScore: number;
};

export type VerifiedRecommendationCandidate = CatalogBookMetadata & {
  strategy: RecommendationStrategy;
  candidateRank: number;
  rationale?: string;
};

export type RecommendationResult = {
  title: string;
  author: string;
  summary: string;
  coverUrl?: string;
  pages?: number;
  releaseYear?: number;
  rating?: number;
  tags?: string[];
  source?: RecommendationSource;
  strategy?: RecommendationStrategy;
  matchScore: number;
  metadataScore: number;
  finalScore: number;
};

export type RecommendationEngineResponse = {
  recs: RecommendationResult[];
  meta: {
    requestType: RecommendationRequestType;
    normalizedQuery: string;
    seedResolved: boolean;
    candidateGroups: Array<{
      strategy: RecommendationStrategy;
      count: number;
    }>;
    verifiedCandidateCount: number;
  };
};
