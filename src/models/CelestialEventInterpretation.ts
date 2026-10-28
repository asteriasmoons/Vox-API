//
//  CelestialEventInterpretation.ts
//  Shared, event-specific AI interpretation (one per stable fingerprint).
//  Reused by every user who opens the same astronomical occurrence.
//

import { Schema, Document, Model } from "mongoose";
import { asteriumDB } from "../config/databases";
import type { CelestialSections } from "../services/celestial/celestialTypes";

export type CelestialInterpretationStatus = "pending" | "partial" | "complete";

export interface CelestialEventInterpretationDoc extends Document {
  fingerprint: string;
  eventId: string;
  type: string;
  category: string;
  name: string;
  schemaVersion: number;
  contentVersion: number;
  sections: CelestialSections;
  completedStages: string[];
  status: CelestialInterpretationStatus;
  aiModel: string;
  sourceEvent: Record<string, unknown>;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CelestialEventInterpretationSchema = new Schema<CelestialEventInterpretationDoc>(
  {
    fingerprint: { type: String, required: true, unique: true, index: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true, index: true },
    category: { type: String, required: true, index: true },
    name: { type: String, required: true },
    schemaVersion: { type: Number, required: true, default: 1 },
    contentVersion: { type: Number, required: true, default: 1 },
    sections: { type: Schema.Types.Mixed, default: {} },
    completedStages: { type: [String], default: [] },
    status: { type: String, required: true, default: "pending", index: true },
    aiModel: { type: String, default: "" },
    sourceEvent: { type: Schema.Types.Mixed, default: {} },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

export const CelestialEventInterpretation: Model<CelestialEventInterpretationDoc> =
  (asteriumDB.models.CelestialEventInterpretation as Model<CelestialEventInterpretationDoc>) ||
  asteriumDB.model<CelestialEventInterpretationDoc>(
    "CelestialEventInterpretation",
    CelestialEventInterpretationSchema,
  );
