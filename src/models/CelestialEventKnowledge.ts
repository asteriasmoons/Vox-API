//
//  CelestialEventKnowledge.ts
//  Reusable, event-TYPE-level knowledge (general eclipse symbolism, seasonal
//  traditions, lunar correspondences, etc.) that can be fed into event-specific
//  generation to reduce redundant Groq calls. Populated only as a side effect
//  of an opened event's generation — never pre-generated for unopened events.
//

import { Schema, Document, Model } from "mongoose";
import { asteriumDB } from "../config/databases";

export interface CelestialEventKnowledgeDoc extends Document {
  key: string;            // e.g. event type or category
  contentVersion: number;
  content: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const CelestialEventKnowledgeSchema = new Schema<CelestialEventKnowledgeDoc>(
  {
    key: { type: String, required: true, unique: true, index: true },
    contentVersion: { type: Number, required: true, default: 1 },
    content: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const CelestialEventKnowledge: Model<CelestialEventKnowledgeDoc> =
  (asteriumDB.models.CelestialEventKnowledge as Model<CelestialEventKnowledgeDoc>) ||
  asteriumDB.model<CelestialEventKnowledgeDoc>(
    "CelestialEventKnowledge",
    CelestialEventKnowledgeSchema,
  );
