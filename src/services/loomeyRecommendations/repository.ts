import { randomUUID } from "node:crypto";
import { Model, Schema } from "mongoose";
import { lumeyDB } from "../../config/databases";
import { hash } from "./normalization";
import { RecommendationError } from "./types";

export interface RecommendationStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  remove(key: string): Promise<void>;
  purgeGroup(group: string): Promise<void>;
  claim(key: string, owner: string, ttlMs: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
  reserve(provider: string, intervalMs: number, dailyLimit: number, signal: AbortSignal): Promise<void>;
}
type CacheRow = { _id: string; group?: string; value?: unknown; owner?: string; leaseUntil?: Date; expiresAt: Date };
type BudgetRow = { _id: string; count: number; nextAt: Date; expiresAt: Date };
const schema = new Schema<CacheRow>({ _id: String, group: { type: String, index: true }, value: Schema.Types.Mixed, owner: String, leaseUntil: Date,
  expiresAt: { type: Date, required: true, index: { expires: 0 } } }, { versionKey: false });
const controlSchema = new Schema<BudgetRow>({ _id: String, count: Number, nextAt: Date,
  expiresAt: { type: Date, required: true, index: { expires: 0 } } }, { versionKey: false });
const Cache: Model<CacheRow> = (lumeyDB.models.LoomeyRecommendationCache as Model<CacheRow> | undefined) ?? lumeyDB.model<CacheRow>("LoomeyRecommendationCache", schema);
const Control: Model<BudgetRow> = (lumeyDB.models.LoomeyRecommendationBudget as Model<BudgetRow> | undefined) ?? lumeyDB.model<BudgetRow>("LoomeyRecommendationBudget", controlSchema);
export const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const done = () => { signal.removeEventListener("abort", abort); resolve(); };
  const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
  const timer = setTimeout(done, ms);
  signal.addEventListener("abort", abort, { once: true });
});

export class MongoRecommendationStore implements RecommendationStore {
  constructor(private models = { Cache, Control }, private isReady = () => lumeyDB.readyState === 1) {}
  private ready() { if (!this.isReady()) throw new RecommendationError("CATALOG_STORE_UNAVAILABLE"); }
  async get<T>(key: string): Promise<T | undefined> {
    this.ready();
    const row = await this.models.Cache.findOne({ _id: hash(key), expiresAt: { $gt: new Date() }, value: { $exists: true } }).lean();
    return row?.value as T | undefined;
  }
  async set(key: string, value: unknown, ttlMs: number) {
    this.ready();
    await this.models.Cache.updateOne({ _id: hash(key) }, { $set: { value, group: key.split(":")[0], expiresAt: new Date(Date.now() + Math.max(1, ttlMs)) } }, { upsert: true });
  }
  async remove(key: string) { this.ready(); await this.models.Cache.deleteOne({ _id: hash(key) }); }
  async purgeGroup(group: string) { this.ready(); await this.models.Cache.deleteMany({ group }); }
  async claim(key: string, owner: string, ttlMs: number) {
    this.ready();
    try {
      const row = await this.models.Cache.findOneAndUpdate({ _id: hash(`lease:${key}`), $or: [{ owner }, { leaseUntil: { $lte: new Date() } }, { leaseUntil: { $exists: false } }] },
        { $set: { owner, leaseUntil: new Date(Date.now() + ttlMs), expiresAt: new Date(Date.now() + ttlMs) } }, { upsert: true, new: true }).lean();
      return row?.owner === owner;
    } catch (error: any) { if (error?.code === 11000) return false; throw error; }
  }
  async release(key: string, owner: string) { this.ready(); await this.models.Cache.deleteOne({ _id: hash(`lease:${key}`), owner }); }
  async reserve(provider: string, intervalMs: number, dailyLimit: number, signal: AbortSignal) {
    this.ready();
    const day = new Date().toISOString().slice(0, 10);
    const tomorrow = Date.parse(`${day}T00:00:00Z`) + 86400000;
    const dailyKey = `loomey:${provider}:${day}`;
    const rateKey = `loomey:${provider}:rate`;
    for (const key of [dailyKey, rateKey]) {
      try { await this.models.Control.updateOne({ _id: key }, { $setOnInsert: { count: 0, nextAt: new Date(0), expiresAt: new Date(tomorrow + 86400000) } }, { upsert: true }); }
      catch (error: any) { if (error?.code !== 11000) throw error; }
    }
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const slot = await this.models.Control.findOneAndUpdate({ _id: rateKey, nextAt: { $lte: new Date() } }, { $set: { nextAt: new Date(Date.now() + intervalMs) } });
      if (slot) {
        const budget = await this.models.Control.findOneAndUpdate({ _id: dailyKey, count: { $lt: dailyLimit } }, { $inc: { count: 1 } });
        if (!budget) throw new RecommendationError("PROVIDER_QUOTA_EXHAUSTED", 429, Math.ceil((tomorrow - Date.now()) / 1000));
        return;
      }
      await pause(Math.min(150, intervalMs), signal);
    }
    throw new RecommendationError("PROVIDER_BUSY", 429, 15);
  }
}

export async function cached<T>(store: RecommendationStore, key: string, ttl: number, signal: AbortSignal, fetch: () => Promise<T>): Promise<T> {
  const previous = await store.get<T>(key);
  if (previous !== undefined) return previous;
  const owner = randomUUID();
  const deadline = Date.now() + 45000;
  while (!await store.claim(key, owner, 45000)) {
    await pause(150, signal);
    const shared = await store.get<T>(key);
    if (shared !== undefined) return shared;
    if (Date.now() > deadline) throw new RecommendationError("PROVIDER_BUSY", 429, 10);
  }
  let ownsLease = true;
  const heartbeat = setInterval(() => {
    void store.claim(key, owner, 45000).then(owned => { ownsLease = owned; }).catch(() => { ownsLease = false; });
  }, 15000);
  heartbeat.unref();
  try {
    const shared = await store.get<T>(key);
    if (shared !== undefined) return shared;
    const result = await fetch();
    if (!ownsLease) throw new RecommendationError("PROVIDER_BUSY", 429, 10);
    await store.set(key, result, ttl);
    return result;
  } finally { clearInterval(heartbeat); await store.release(key, owner); }
}
