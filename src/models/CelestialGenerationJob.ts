//
//  CelestialGenerationJob.ts
//  Durable generation job (one per fingerprint). State lives in MongoDB so the
//  queue survives backend restarts; a background worker claims and advances
//  jobs stage-by-stage, respecting Groq rate limits.
//

import { Schema, Document, Model } from "mongoose";
import { asteriumDB } from "../config/databases";
import type { CelestialEventPayload } from "../services/celestial/celestialTypes";

export type CelestialJobStatus =
  | "queued"
  | "running"
  | "waiting"      // waiting for rate-limit capacity
  | "partial"
  | "completed"
  | "failed";

export interface CelestialGenerationJobDoc extends Document {
  fingerprint: string;
  status: CelestialJobStatus;
  completedStages: string[];
  pendingStages: string[];
  attempts: number;
  lastError?: string;
  nextAttemptAt?: Date;
  lockedAt?: Date;
  lockOwner?: string;
  payload: CelestialEventPayload;
  createdAt: Date;
  updatedAt: Date;
}

const CelestialGenerationJobSchema = new Schema<CelestialGenerationJobDoc>(
  {
    fingerprint: { type: String, required: true, unique: true, index: true },
    status: { type: String, required: true, default: "queued", index: true },
    completedStages: { type: [String], default: [] },
    pendingStages: { type: [String], default: [] },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    nextAttemptAt: { type: Date },
    lockedAt: { type: Date },
    lockOwner: { type: String },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

export const CelestialGenerationJob: Model<CelestialGenerationJobDoc> =
  (asteriumDB.models.CelestialGenerationJob as Model<CelestialGenerationJobDoc>) ||
  asteriumDB.model<CelestialGenerationJobDoc>(
    "CelestialGenerationJob",
    CelestialGenerationJobSchema,
  );
