import { Schema, type Document, type Model } from "mongoose";
import { lumeyDB } from "../config/databases";

export interface LoomeyBookCoverDoc extends Document {
  storageKey: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  title: string;
  author: string;
  normalizedTitle: string;
  normalizedAuthor: string;
  isbns: string[];
  edition?: string;
  uploadedAt: Date;
}

const schema = new Schema<LoomeyBookCoverDoc>({
  storageKey: { type: String, required: true, unique: true },
  sha256: { type: String, required: true, unique: true },
  mimeType: { type: String, required: true },
  byteSize: { type: Number, required: true },
  title: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  normalizedTitle: { type: String, required: true, index: true },
  normalizedAuthor: { type: String, required: true, index: true },
  isbns: { type: [String], default: [], index: true },
  edition: { type: String, trim: true },
  uploadedAt: { type: Date, default: Date.now },
});
schema.index({ normalizedTitle: 1, normalizedAuthor: 1 });
export const LoomeyBookCover: Model<LoomeyBookCoverDoc> =
  (lumeyDB.models.LoomeyBookCover as Model<LoomeyBookCoverDoc>) ||
  lumeyDB.model<LoomeyBookCoverDoc>("LoomeyBookCover", schema, "bookcovers");
