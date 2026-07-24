import crypto from "node:crypto";
import { GeneratedRecommendationShelf } from "../models/GeneratedRecommendationShelf";
import type {
  GeneratedRecommendationShelfDoc,
  GeneratedRecommendationShelfStatus,
} from "../models/GeneratedRecommendationShelf";
import type { RecommendationCollectionsResponse } from "./recommendationCollectionService";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const STALE_GENERATION_MS = 10 * 60 * 1000;
const GENERATION_WAIT_MS = 65_000;
const GENERATION_POLL_MS = 500;

type ShelfDocLike = {
  userId: string;
  shelfKey: string;
  shelfTitle: string;
  status: GeneratedRecommendationShelfStatus;
  response?: RecommendationCollectionsResponse;
  generationId?: string;
  generationStartedAt?: Date;
  refreshGenerationId?: string;
  refreshStartedAt?: Date;
  completedAt?: Date;
  regenerateAfter?: Date;
  lastError?: string;
};

type UpdateResultLike = {
  modifiedCount?: number;
  matchedCount?: number;
};

type GeneratedShelfModelLike = {
  findOne(filter: Record<string, unknown>): {
    lean(): Promise<ShelfDocLike | null>;
  };
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): {
    lean(): Promise<ShelfDocLike | null>;
  };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<UpdateResultLike>;
};

type ShelfClaim = {
  generationId: string;
  startedAt: Date;
};

export type ShelfCacheLookup =
  | { state: "fresh"; response: RecommendationCollectionsResponse }
  | { state: "expired"; response: RecommendationCollectionsResponse }
  | { state: "generating" }
  | { state: "miss" };

function nowDate(): Date {
  return new Date();
}

function newGenerationId(): string {
  return crypto.randomUUID();
}

function isFresh(doc: ShelfDocLike, now: Date): boolean {
  return (
    doc.status === "completed" &&
    Boolean(doc.response) &&
    Boolean(doc.regenerateAfter) &&
    doc.regenerateAfter!.getTime() > now.getTime()
  );
}

function isExpiredCompleted(doc: ShelfDocLike, now: Date): boolean {
  return (
    doc.status === "completed" &&
    Boolean(doc.response) &&
    (!doc.regenerateAfter || doc.regenerateAfter.getTime() <= now.getTime())
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGeneratedRecommendationShelfService(
  model: GeneratedShelfModelLike = GeneratedRecommendationShelf,
) {
  return {
    async getOtherShelfBookKeys(
      userId: string,
      excludeShelfKey: string,
    ): Promise<string[]> {
      const docs = await (model as any).find({
        userId,
        shelfKey: { $ne: excludeShelfKey },
        status: "completed",
        response: { $exists: true },
      }).lean();

      const keys: string[] = [];
      for (const doc of docs ?? []) {
        const collections = doc.response?.collections;
        if (!Array.isArray(collections)) continue;
        for (const collection of collections) {
          if (!Array.isArray(collection.books)) continue;
          for (const book of collection.books) {
            if (book.title) {
              keys.push(`${(book.title ?? "").toLowerCase().trim()}|${(book.author ?? "").toLowerCase().trim()}`);
            }
          }
        }
      }
      return keys;
    },

    async lookup(userId: string, shelfKey: string): Promise<ShelfCacheLookup> {
      const now = nowDate();
      const staleBefore = new Date(now.getTime() - STALE_GENERATION_MS);
      const doc = await model.findOne({ userId, shelfKey }).lean();
      if (!doc) return { state: "miss" };
      if (isFresh(doc, now)) return { state: "fresh", response: doc.response! };
      if (isExpiredCompleted(doc, now)) {
        return { state: "expired", response: doc.response! };
      }
      if (doc.status === "generating") {
        if (
          !doc.generationStartedAt ||
          doc.generationStartedAt.getTime() <= staleBefore.getTime()
        ) {
          return { state: "miss" };
        }
        return { state: "generating" };
      }
      return { state: "miss" };
    },

    async claimGeneration(input: {
      userId: string;
      shelfKey: string;
      shelfTitle: string;
    }): Promise<ShelfClaim | null> {
      const now = nowDate();
      const staleBefore = new Date(now.getTime() - STALE_GENERATION_MS);
      const generationId = newGenerationId();

      try {
        const doc = await model
          .findOneAndUpdate(
            {
              userId: input.userId,
              shelfKey: input.shelfKey,
              $or: [
                { status: { $exists: false } },
                { status: "failed" },
                { status: "generating", generationStartedAt: { $exists: false } },
                { status: "generating", generationStartedAt: { $lte: staleBefore } },
              ],
            },
            {
              $set: {
                userId: input.userId,
                shelfKey: input.shelfKey,
                shelfTitle: input.shelfTitle,
                status: "generating",
                generationId,
                generationStartedAt: now,
                lastError: "",
              },
              $unset: {
                refreshGenerationId: "",
                refreshStartedAt: "",
            },
            },
            {
              new: true,
              upsert: true,
              setDefaultsOnInsert: true,
            },
          )
          .lean();

        return doc?.generationId === generationId
          ? { generationId, startedAt: now }
          : null;
      } catch (error) {
        if (isDuplicateKeyError(error)) return null;
        throw error;
      }
    },

    async claimRefresh(input: {
      userId: string;
      shelfKey: string;
      shelfTitle: string;
    }): Promise<ShelfClaim | null> {
      const now = nowDate();
      const staleBefore = new Date(now.getTime() - STALE_GENERATION_MS);
      const generationId = newGenerationId();
      const doc = await model
        .findOneAndUpdate(
          {
            userId: input.userId,
            shelfKey: input.shelfKey,
            status: "completed",
            response: { $exists: true },
            $or: [
              { refreshGenerationId: { $exists: false } },
              { refreshGenerationId: "" },
              { refreshStartedAt: { $lte: staleBefore } },
            ],
          },
          {
            $set: {
              shelfTitle: input.shelfTitle,
              refreshGenerationId: generationId,
              refreshStartedAt: now,
              lastError: "",
            },
          },
          { new: true },
        )
        .lean();

      return doc?.refreshGenerationId === generationId
        ? { generationId, startedAt: now }
        : null;
    },

    async completeGeneration(input: {
      userId: string;
      shelfKey: string;
      generationId: string;
      response: RecommendationCollectionsResponse;
    }): Promise<boolean> {
      const completedAt = nowDate();
      const result = await model.updateOne(
        {
          userId: input.userId,
          shelfKey: input.shelfKey,
          generationId: input.generationId,
          status: "generating",
        },
        {
          $set: {
            status: "completed",
            response: input.response,
            completedAt,
            regenerateAfter: new Date(completedAt.getTime() + THREE_DAYS_MS),
            lastError: "",
          },
          $unset: {
            generationId: "",
            generationStartedAt: "",
            refreshGenerationId: "",
            refreshStartedAt: "",
          },
        },
      );

      return (result.modifiedCount ?? result.matchedCount ?? 0) > 0;
    },

    async completeRefresh(input: {
      userId: string;
      shelfKey: string;
      generationId: string;
      response: RecommendationCollectionsResponse;
    }): Promise<boolean> {
      const completedAt = nowDate();
      const result = await model.updateOne(
        {
          userId: input.userId,
          shelfKey: input.shelfKey,
          refreshGenerationId: input.generationId,
          status: "completed",
        },
        {
          $set: {
            response: input.response,
            completedAt,
            regenerateAfter: new Date(completedAt.getTime() + THREE_DAYS_MS),
            lastError: "",
          },
          $unset: {
            refreshGenerationId: "",
            refreshStartedAt: "",
          },
        },
      );

      return (result.modifiedCount ?? result.matchedCount ?? 0) > 0;
    },

    async failGeneration(input: {
      userId: string;
      shelfKey: string;
      generationId: string;
      error: unknown;
    }): Promise<void> {
      await model.updateOne(
        {
          userId: input.userId,
          shelfKey: input.shelfKey,
          generationId: input.generationId,
          status: "generating",
        },
        {
          $set: {
            status: "failed",
            lastError:
              input.error instanceof Error ? input.error.message : String(input.error),
          },
          $unset: {
            generationId: "",
            generationStartedAt: "",
          },
        },
      );
    },

    async failRefresh(input: {
      userId: string;
      shelfKey: string;
      generationId: string;
      error: unknown;
    }): Promise<void> {
      await model.updateOne(
        {
          userId: input.userId,
          shelfKey: input.shelfKey,
          refreshGenerationId: input.generationId,
          status: "completed",
        },
        {
          $set: {
            lastError:
              input.error instanceof Error ? input.error.message : String(input.error),
          },
          $unset: {
            refreshGenerationId: "",
            refreshStartedAt: "",
          },
        },
      );
    },

    async waitForCompletedShelf(
      userId: string,
      shelfKey: string,
      waitMs = GENERATION_WAIT_MS,
    ): Promise<RecommendationCollectionsResponse | null> {
      const deadline = Date.now() + waitMs;

      while (Date.now() < deadline) {
        await sleep(GENERATION_POLL_MS);
        const doc = await model.findOne({ userId, shelfKey }).lean();
        if (doc?.status === "completed" && doc.response) return doc.response;
        if (doc?.status === "failed") return null;
      }

      return null;
    },
  };
}

export type GeneratedRecommendationShelfService = ReturnType<
  typeof createGeneratedRecommendationShelfService
>;

export const generatedRecommendationShelfService =
  createGeneratedRecommendationShelfService(
    GeneratedRecommendationShelf as unknown as GeneratedShelfModelLike,
  );
