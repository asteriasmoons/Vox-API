import { purgeAutomaticCatalogCaches } from "./automaticCatalogStore";
import { bookDatabaseClient } from "./automaticCatalogService";

export function startAutomaticCatalogMaintenance(): void {
  const maintain = async () => {
    try {
      if (!process.env.BOOKDATABASE_API_KEY || process.env.BOOKDATABASE_DISABLED === "true") {
        await purgeAutomaticCatalogCaches();
      } else {
        // Periodic license/access check also detects revocation while no app is open.
        await bookDatabaseClient.get("books/random?includeRelationships=None", 15 * 60_000);
      }
    } catch (error: any) {
      if (["PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error?.code)) await purgeAutomaticCatalogCaches().catch(() => {});
      // No keys, provider bodies, or personalized request bodies belong in logs.
      console.warn("Automatic catalog maintenance:", error?.code ?? "UNAVAILABLE");
    }
  };
  void maintain();
  const timer = setInterval(() => { void maintain(); }, 15 * 60_000);
  timer.unref();
}
