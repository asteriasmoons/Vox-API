import "dotenv/config";
import { BookDatabaseClient } from "../bookDatabaseClient";
import { LoomeyRecommendationEngine } from "./engine";
import { BookDatabaseSupplement } from "./providers/bookDatabase";
import { GoogleBooksProvider } from "./providers/googleBooks";
import { HardcoverProvider } from "./providers/hardcover";
import { OpenLibraryProvider } from "./providers/openLibrary";
import { MongoRecommendationStore } from "./repository";
import { ProviderTransport } from "./transport";
import { PostgresBookKnowledgeSource } from "./knowledgeSource";
import { bookPool } from "../../bookKnowledge/db";
import { catalogLog } from "../catalogDiagnostics";

// Idle pool errors are independent of a request; handle them in the API, not the worker.
bookPool.on("error", error => catalogLog("engine.knowledge_pool_failed", { code: (error as NodeJS.ErrnoException).code ?? "KNOWLEDGE_UNAVAILABLE" }));

const store = new MongoRecommendationStore();
const transport = new ProviderTransport(store);
export const bookDatabaseClient = new BookDatabaseClient();
export const bookDatabaseSupplement = new BookDatabaseSupplement(bookDatabaseClient, store);
export const loomeyRecommendationEngine = new LoomeyRecommendationEngine(store,
  [new HardcoverProvider(transport), new GoogleBooksProvider(transport), new OpenLibraryProvider(transport)], bookDatabaseSupplement, undefined, new PostgresBookKnowledgeSource(store));
export { categoryIDs, RecommendationError } from "./types";
export { parseLibrary } from "./normalization";
export { parseReadingPreferences } from "./readingPreferences";
