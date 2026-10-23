import { purgeAutomaticCatalogCaches } from "./automaticCatalogStore";
import { bookDatabaseSupplement } from "./loomeyRecommendations";

export function startAutomaticCatalogMaintenance(): void {
  const maintain = async () => {
    try {
      await bookDatabaseSupplement.maintain();
      // Retired provider-only caches are separate from the new engine's independent provider data.
      if (!await bookDatabaseSupplement.available()) await purgeAutomaticCatalogCaches();
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
