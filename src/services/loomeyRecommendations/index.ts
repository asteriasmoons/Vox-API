import "dotenv/config";
import { BookDatabaseClient } from "../bookDatabaseClient";
import { LoomeyRecommendationEngine } from "./engine";
import { BookDatabaseSupplement } from "./providers/bookDatabase";
import { GoogleBooksProvider } from "./providers/googleBooks";
import { HardcoverProvider } from "./providers/hardcover";
import { OpenLibraryProvider } from "./providers/openLibrary";
import { MongoRecommendationStore } from "./repository";
import { ProviderTransport } from "./transport";

const store = new MongoRecommendationStore();
const transport = new ProviderTransport(store);
export const bookDatabaseClient = new BookDatabaseClient();
export const bookDatabaseSupplement = new BookDatabaseSupplement(bookDatabaseClient, store);
export const loomeyRecommendationEngine = new LoomeyRecommendationEngine(store,
  [new HardcoverProvider(transport), new GoogleBooksProvider(transport), new OpenLibraryProvider(transport)], bookDatabaseSupplement);
export { categoryIDs, RecommendationError } from "./types";
export { parseLibrary } from "./normalization";
