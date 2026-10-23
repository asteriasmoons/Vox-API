import "dotenv/config";
import mongoose from "mongoose";
import { purgeAutomaticCatalogCaches } from "../dist/services/automaticCatalogStore.js";

try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await purgeAutomaticCatalogCaches();
  console.log("Temporary automatic catalog caches purged. Collections and library records were not touched.");
} finally {
  await mongoose.disconnect();
}
