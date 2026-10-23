import mongoose, { Schema } from "mongoose";
import { createHash } from "node:crypto";

const cacheSchema = new Schema({
  _id: String, scope: { type: String, index: true }, value: Schema.Types.Mixed,
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  leaseUntil: Date, owner: String,
}, { versionKey: false });
const controlSchema = new Schema({
  _id: String, count: { type: Number, default: 0 }, nextAt: { type: Date, default: new Date(0) },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { versionKey: false });
const Cache = mongoose.model("AutomaticCatalogCache", cacheSchema);
const Control = mongoose.model("AutomaticCatalogControl", controlSchema);
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class CatalogError extends Error {
  constructor(public code: string, public status = 503, public retryAfter = 60) { super(code); }
}

export async function purgeAutomaticCatalogCaches(): Promise<void> {
  if (mongoose.connection.readyState !== 1) throw new CatalogError("CATALOG_STORE_UNAVAILABLE");
  // This collection contains only temporary automatic-catalog data, never Collections.
  await Cache.deleteMany({});
}

export async function limitCatalogRequests(subject: string, limit: number): Promise<void> {
  if (mongoose.connection.readyState !== 1) throw new CatalogError("CATALOG_STORE_UNAVAILABLE");
  const minute = Math.floor(Date.now() / 60_000);
  const key = `catalog-request:${digest(subject)}:${minute}`;
  try {
    await Control.updateOne({ _id: key }, { $setOnInsert: { count: 0, expiresAt: new Date(Date.now() + 120_000) } }, { upsert: true });
  } catch (error: any) { if (error?.code !== 11000) throw error; }
  const updated = await Control.findOneAndUpdate({ _id: key, count: { $lt: limit } }, { $inc: { count: 1 } });
  if (!updated) throw new CatalogError("TOO_MANY_REQUESTS", 429, 60);
}

export interface CatalogStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, expiresAt: Date): Promise<void>;
  claim(key: string, owner: string): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
  reserve(): Promise<void>;
  purge(): Promise<void>;
}

export function mongoCatalogStore(scope: string, models = { Cache, Control }, isReady = () => mongoose.connection.readyState === 1): CatalogStore {
  const { Cache, Control } = models;
  const id = (key: string) => `${scope}:${digest(key)}`;
  const ready = () => {
    if (!isReady()) throw new CatalogError("CATALOG_STORE_UNAVAILABLE");
  };
  async function initialize(key: string, expiresAt: Date) {
    ready();
    try {
      await Control.updateOne({ _id: key }, { $setOnInsert: { count: 0, nextAt: new Date(0), expiresAt } }, { upsert: true });
    } catch (error: any) { if (error?.code !== 11000) throw error; }
  }
  return {
    async get(key) {
      ready();
      const doc = await Cache.findOne({ _id: id(key), expiresAt: { $gt: new Date() }, value: { $exists: true } }).lean();
      return doc?.value;
    },
    async set(key, value, expiresAt) {
      ready();
      await Cache.updateOne({ _id: id(key) }, { $set: { scope, value, expiresAt } }, { upsert: true });
    },
    async claim(key, owner) {
      ready();
      const now = new Date();
      try {
        const doc = await Cache.findOneAndUpdate({
          _id: id(`lock:${key}`), $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }],
        }, { $set: { scope, owner, leaseUntil: new Date(Date.now() + 120_000), expiresAt: new Date(Date.now() + 120_000) } }, { upsert: true, new: true }).lean();
        return doc?.owner === owner;
      } catch (error: any) { if (error?.code === 11000) return false; throw error; }
    },
    async release(key, owner) { await Cache.deleteOne({ _id: id(`lock:${key}`), owner }); },
    async purge() { ready(); await Cache.deleteMany({ scope }); },
    async reserve() {
      // Mongo CAS enforces the same provider budget across workers and restarts.
      const day = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(`${day}T00:00:00Z`).getTime() + 86_400_000;
      const dailyKey = `${scope}:daily:${day}`;
      const rateKey = `${scope}:rate`;
      await initialize(dailyKey, new Date(tomorrow + 86_400_000));
      await initialize(rateKey, new Date(Date.now() + 7 * 86_400_000));
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const slot = await Control.findOneAndUpdate({ _id: rateKey, nextAt: { $lte: new Date() } },
          { $set: { nextAt: new Date(Date.now() + 1100), expiresAt: new Date(Date.now() + 7 * 86_400_000) } }, { new: true });
        if (slot) {
          const daily = await Control.findOneAndUpdate({ _id: dailyKey, count: { $lt: 5000 } }, { $inc: { count: 1 } }, { new: true });
          if (!daily) throw new CatalogError("PROVIDER_QUOTA_EXHAUSTED", 429, Math.ceil((tomorrow - Date.now()) / 1000));
          return;
        }
        await delay(150);
      }
      throw new CatalogError("PROVIDER_BUSY", 429, 15);
    },
  };
}
