import { Schema, model, Document, Model } from "mongoose";
import { lunixiaDB } from "../config/databases";

export interface DailyPromptUsageDoc extends Document {
  userId: string;
  dateKey: string;
  count: number;
  updatedAt: Date;
}

const DailyPromptUsageSchema = new Schema<DailyPromptUsageDoc>(
  {
    userId: { type: String, required: true, index: true },
    dateKey: { type: String, required: true, index: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

DailyPromptUsageSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

export const DailyPromptUsage: Model<DailyPromptUsageDoc> =
  (lunixiaDB.models.DailyPromptUsage as Model<DailyPromptUsageDoc>) ||
  lunixiaDB.model<DailyPromptUsageDoc>(
    "DailyPromptUsage",
    DailyPromptUsageSchema,
  );