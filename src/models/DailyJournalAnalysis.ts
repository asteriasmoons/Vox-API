import { Schema, model, Document, Model } from "mongoose";
import { lunixiaDB } from "../config/databases";

export interface DailyJournalAnalysisDoc extends Document {
  userId: string;
  bookId: string;
  dateKey: string;
  themes: string[];
  tags: string[];
  mood: string;
  reflection: string;
  mindfulMinutes: number;
  entryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const DailyJournalAnalysisSchema = new Schema<DailyJournalAnalysisDoc>(
  {
    userId: { type: String, required: true, index: true },
    bookId: { type: String, required: true, index: true },
    dateKey: { type: String, required: true, index: true },
    themes: { type: [String], required: true, default: [] },
    tags: { type: [String], default: [] },
    mood: { type: String, required: true, default: "" },
    reflection: { type: String, required: true, default: "" },
    mindfulMinutes: { type: Number, default: 0 },
    entryCount: { type: Number, default: 1 },
  },
  { timestamps: true },
);

DailyJournalAnalysisSchema.index(
  { userId: 1, bookId: 1, dateKey: 1 },
  { unique: true },
);

export const DailyJournalAnalysis: Model<DailyJournalAnalysisDoc> =
  (lunixiaDB.models.DailyJournalAnalysis as Model<DailyJournalAnalysisDoc>) ||
  lunixiaDB.model<DailyJournalAnalysisDoc>(
    "DailyJournalAnalysis",
    DailyJournalAnalysisSchema,
  );