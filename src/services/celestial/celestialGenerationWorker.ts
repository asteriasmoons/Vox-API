//
//  celestialGenerationWorker.ts
//  Durable, Mongo-backed generation queue + background worker. Job state lives
//  in MongoDB, so the queue survives backend restarts (stale in-flight jobs are
//  reclaimed). Jobs are keyed by fingerprint, so concurrent opens of the same
//  event share ONE job rather than firing duplicate Groq requests. A job is
//  created ONLY when a user opens an event (via ensureGeneration) — never
//  pre-generated.
//

import {
  CelestialGenerationJob,
  CelestialGenerationJobDoc,
} from "../../models/CelestialGenerationJob";
import {
  CelestialEventInterpretation,
  CelestialEventInterpretationDoc,
} from "../../models/CelestialEventInterpretation";
import {
  CelestialEventPayload,
  CelestialStage,
  CELESTIAL_STAGES,
  CELESTIAL_SCHEMA_VERSION,
  CELESTIAL_CONTENT_VERSION,
  computeFingerprint,
} from "./celestialTypes";
import {
  generateCelestialStage,
  upsertReusableKnowledge,
  CELESTIAL_GROQ_MODEL,
} from "./celestialGenerationService";
import { CELESTIAL_GROQ_CONCURRENCY } from "./celestialRateLimiter";

const MAX_ATTEMPTS = Math.max(1, Number(process.env.CELESTIAL_MAX_ATTEMPTS) || 5);
const STALE_LOCK_MS = 3 * 60_000;
const TICK_MS = Math.max(2_000, Number(process.env.CELESTIAL_WORKER_TICK_MS) || 5_000);
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const LOCK_OWNER = `worker-${process.pid}`;

let workerStarted = false;

// ---------------------------------------------------------------------------
// Enqueue (called only when a user opens an event)
// ---------------------------------------------------------------------------

export interface CelestialSnapshot {
  fingerprint: string;
  status: CelestialEventInterpretationDoc["status"];
  name: string;
  type: string;
  category: string;
  sections: Record<string, unknown>;
  completedStages: string[];
  pendingStages: string[];
  jobStatus: string | null;
  lastError: string | null;
}

/**
 * Ensures a shared interpretation (and, if incomplete, a generation job) exists
 * for the opened event. Returns the current snapshot. Idempotent and safe for
 * concurrent callers (unique fingerprint).
 */
export async function ensureGeneration(payload: CelestialEventPayload): Promise<CelestialSnapshot> {
  const fingerprint = computeFingerprint(payload);

  let interp = await CelestialEventInterpretation.findOne({ fingerprint });
  if (!interp) {
    try {
      interp = await CelestialEventInterpretation.create({
        fingerprint,
        eventId: payload.id,
        type: payload.type,
        category: payload.category,
        name: payload.name,
        schemaVersion: CELESTIAL_SCHEMA_VERSION,
        contentVersion: CELESTIAL_CONTENT_VERSION,
        sections: {},
        completedStages: [],
        status: "pending",
        aiModel: CELESTIAL_GROQ_MODEL,
        sourceEvent: payload as unknown as Record<string, unknown>,
      });
    } catch {
      // Concurrent create — re-read.
      interp = await CelestialEventInterpretation.findOne({ fingerprint });
    }
  }
  if (!interp) throw new Error("Could not create or load interpretation");

  if (interp.status !== "complete") {
    await ensureJob(fingerprint, payload, interp.completedStages);
  }

  return snapshotFrom(fingerprint, interp);
}

async function ensureJob(
  fingerprint: string,
  payload: CelestialEventPayload,
  completedStages: string[],
): Promise<void> {
  const pending = CELESTIAL_STAGES.filter((s) => !completedStages.includes(s));
  if (pending.length === 0) return;
  const existing = await CelestialGenerationJob.findOne({ fingerprint });
  if (existing) {
    // Resume a stuck/failed job on re-open without duplicating it.
    if (existing.status === "failed" || existing.status === "waiting") {
      await CelestialGenerationJob.updateOne(
        { fingerprint },
        { $set: { status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null } },
      );
    }
    return;
  }
  try {
    await CelestialGenerationJob.create({
      fingerprint,
      status: "queued",
      completedStages,
      pendingStages: pending,
      attempts: 0,
      payload,
    });
  } catch {
    // Concurrent create — unique fingerprint guard; ignore.
  }
}

export async function snapshot(fingerprint: string): Promise<CelestialSnapshot | null> {
  const interp = await CelestialEventInterpretation.findOne({ fingerprint });
  if (!interp) return null;
  return snapshotFrom(fingerprint, interp);
}

async function snapshotFrom(
  fingerprint: string,
  interp: CelestialEventInterpretationDoc,
): Promise<CelestialSnapshot> {
  const job = await CelestialGenerationJob.findOne({ fingerprint }).lean();
  return {
    fingerprint,
    status: interp.status,
    name: interp.name,
    type: interp.type,
    category: interp.category,
    sections: (interp.sections as Record<string, unknown>) ?? {},
    completedStages: interp.completedStages ?? [],
    pendingStages: CELESTIAL_STAGES.filter((s) => !(interp.completedStages ?? []).includes(s)),
    jobStatus: job ? job.status : interp.status === "complete" ? "completed" : null,
    lastError: job?.lastError ?? null,
  };
}

/** Authorized regeneration: clear sections and re-queue all stages. */
export async function regenerate(payload: CelestialEventPayload): Promise<CelestialSnapshot> {
  const fingerprint = computeFingerprint(payload);
  await CelestialEventInterpretation.updateOne(
    { fingerprint },
    {
      $set: {
        sections: {},
        completedStages: [],
        status: "pending",
        contentVersion: CELESTIAL_CONTENT_VERSION,
        completedAt: null,
      },
    },
    { upsert: false },
  );
  await CelestialGenerationJob.updateOne(
    { fingerprint },
    {
      $set: {
        status: "queued",
        completedStages: [],
        pendingStages: CELESTIAL_STAGES,
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        payload,
      },
    },
    { upsert: true },
  );
  return ensureGeneration(payload);
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

export function startCelestialGenerationWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  console.log("[celestial] generation worker started");
  const loop = async () => {
    try {
      await reclaimStaleJobs();
      for (let i = 0; i < CELESTIAL_GROQ_CONCURRENCY; i += 1) {
        const claimed = await claimNextJob();
        if (!claimed) break;
        await processOneStage(claimed);
      }
    } catch (error) {
      console.error("[celestial] worker tick error:", error instanceof Error ? error.message : error);
    } finally {
      setTimeout(loop, TICK_MS);
    }
  };
  setTimeout(loop, TICK_MS);
}

async function reclaimStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS);
  await CelestialGenerationJob.updateMany(
    { status: "running", lockedAt: { $lt: cutoff } },
    { $set: { status: "partial", lockOwner: null } },
  );
}

async function claimNextJob(): Promise<CelestialGenerationJobDoc | null> {
  const now = new Date();
  return CelestialGenerationJob.findOneAndUpdate(
    {
      status: { $in: ["queued", "partial", "waiting"] },
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
    },
    { $set: { status: "running", lockedAt: now, lockOwner: LOCK_OWNER } },
    { sort: { updatedAt: 1 }, new: true },
  );
}

async function processOneStage(job: CelestialGenerationJobDoc): Promise<void> {
  const fingerprint = job.fingerprint;
  const payload = job.payload as CelestialEventPayload;

  const interp = await CelestialEventInterpretation.findOne({ fingerprint });
  const completed = interp?.completedStages ?? [];
  const stage = CELESTIAL_STAGES.find((s) => !completed.includes(s)) as CelestialStage | undefined;

  if (!stage) {
    await finishJob(fingerprint);
    return;
  }

  try {
    const section = await generateCelestialStage(stage, payload);

    await CelestialEventInterpretation.updateOne(
      { fingerprint },
      { $set: { [`sections.${stage}`]: section }, $addToSet: { completedStages: stage } },
    );
    if (stage === "overviewAstrology") {
      await upsertReusableKnowledge(payload.type, section);
    }

    const refreshed = await CelestialEventInterpretation.findOne({ fingerprint });
    const nowCompleted = refreshed?.completedStages ?? [];
    const allDone = CELESTIAL_STAGES.every((s) => nowCompleted.includes(s));
    await CelestialEventInterpretation.updateOne(
      { fingerprint },
      { $set: { status: allDone ? "complete" : "partial", ...(allDone ? { completedAt: new Date() } : {}) } },
    );

    const pending = CELESTIAL_STAGES.filter((s) => !nowCompleted.includes(s));
    if (pending.length === 0) {
      await finishJob(fingerprint);
    } else {
      // One stage per claim spreads Groq calls across ticks. Reset the per-stage
      // retry budget and release the lock so the next tick continues.
      await CelestialGenerationJob.updateOne(
        { fingerprint },
        {
          $set: {
            status: "partial",
            completedStages: nowCompleted,
            pendingStages: pending,
            attempts: 0,
            nextAttemptAt: new Date(Date.now() + 500),
            lockOwner: null,
            lastError: null,
          },
        },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = (job.attempts ?? 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
    // Completed sections are preserved regardless of this stage's failure.
    await CelestialGenerationJob.updateOne(
      { fingerprint },
      {
        $set: {
          status: failed ? "failed" : "waiting",
          attempts,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + delay),
          lockOwner: null,
        },
      },
    );
    console.error(`[celestial] stage ${stage} failed (attempt ${attempts}): ${message}`);
  }
}

async function finishJob(fingerprint: string): Promise<void> {
  await CelestialEventInterpretation.updateOne(
    { fingerprint },
    { $set: { status: "complete", completedAt: new Date() } },
  );
  await CelestialGenerationJob.updateOne(
    { fingerprint },
    { $set: { status: "completed", pendingStages: [], lockOwner: null, lastError: null } },
  );
}
