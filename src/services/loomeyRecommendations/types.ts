export const ENGINE_VERSION = "loomey-2";
export const categoryTitles = {
  similar: "You Might Also Like",
  genres: "Based on Your Favorite Genres",
  themes: "Explore Similar Themes",
  "new-authors": "Discover New Authors",
  "authors-read": "More From Authors You Read",
  related: "Related Books",
  discovery: "Discover Something New",
} as const;
export type CategoryID = keyof typeof categoryTitles;
export const categoryIDs = Object.keys(categoryTitles) as CategoryID[];
export type ProviderName = "hardcover" | "google-books" | "open-library" | "bookdatabase.io";
export type LibraryBook = {
  id: string; title: string; author: string; isbn?: string; genres: string[]; subjects: string[];
  status: string; rating: number; favorite: boolean; activity: number; providerBookID?: string;
  seriesName?: string; seriesNumber?: string; subtitle?: string;
};
export type ReadingPreferences = {
  version: 1;
  preferredCategory: "fiction" | "nonfiction" | "both";
  favoriteFictionGenres: string[];
  favoriteNonfictionGenres: string[];
  currentlyInterestedIn: string[];
  recommendationStyle: "follow_preferences" | "blend_interests" | "surprise_me";
};
export type Series = { id: string; name: string; position: number | null };
export type Book = {
  id: string; title: string; subtitle: string | null; authors: string[]; description: string;
  isbns: string[]; providerIDs: Partial<Record<ProviderName, string[]>>; titleVariants: string[];
  genres: string[]; subjects: string[]; tags: string[]; authorIDs: string[]; tagIDs: string[];
  series: Series[]; relatedIDs: string[]; coverUrls: string[]; language: "eng" | "unknown";
  pages: number | null; publisher: string | null; releaseYear: number | null; popularity: number;
  sources: ProviderName[];
  coverQuality?: "thumbnail" | "cover";
  imageID?: string;
  metadataExpiresAt?: string;
  knowledgeWorkIDs?: string[];
};
export type CatalogBook = {
  id: string; title: string; author: string; authorNames: string[]; subtitle: string | null; summary: string;
  isbn: string | null; isbns: string[]; pages: number | null; publisher: string | null; releaseYear: number | null;
  coverUrl: string | null; coverUrls: string[]; imageID: string | null; genres: string[]; subjects: string[];
  source: string; language: string; titleVariants: string[]; providerIDs: Book["providerIDs"];
  metadataExpiresAt?: string;
};
export type CategoryState = { state: "ready" | "empty" | "error" | "stale"; generatedAt: string; refreshAfter: string; expiresAt: string; errorCode?: string };
export type Catalog = { id: string; title: string; books: CatalogBook[]; generatedAt?: string; refreshAfter?: string; expiresAt?: string; state?: string };
export type CatalogResponse = {
  catalogs: Catalog[]; generatedAt: string; refreshAfter: string; expiresAt: string; partial: boolean;
  categoryStates: Record<string, CategoryState>; engineVersion: string; traceID?: string; disabledSources?: string[];
};
export type JobResponse = CatalogResponse & { state: "building" | "ready" | "failed"; retryAfter?: number; errorCode?: string };
export type DiscoveryPlan = {
  key: string; kind: "author" | "series" | "interests" | "related";
  categories: CategoryID[]; author?: string; authorID?: string; seriesID?: string; seriesName?: string;
  terms: string[]; tagIDs: string[]; workIDs: string[];
  preferenceDriven?: boolean;
};
export type ProviderContext = { signal: AbortSignal; traceID: string; budgets?: Partial<Record<ProviderName, number>>; failures?: Set<ProviderName> };
export interface DiscoveryProvider {
  readonly name: ProviderName;
  available(): boolean;
  resolve(books: LibraryBook[], context: ProviderContext): Promise<Book[]>;
  discover(plan: DiscoveryPlan, context: ProviderContext): Promise<Book[]>;
  enrich(book: Book, context: ProviderContext): Promise<Book | null>;
}
export interface BookKnowledgeSource {
  available(): boolean;
  resolve(books: LibraryBook[], context: ProviderContext): Promise<Book[]>;
  discover(plan: DiscoveryPlan, context: ProviderContext, preferences?: ReadingPreferences): Promise<Book[]>;
}
export class RecommendationError extends Error {
  constructor(readonly code: string, readonly status = 503, readonly retryAfter = 60) { super(code); }
}
