import { Schema, Document, Model } from "mongoose";
import { lumeyDB } from "../config/databases";
import type { RecommendationCollectionsResponse } from "../services/recommendationCollectionService";

export type GeneratedRecommendationShelfStatus =
  | "generating"
  | "completed"
  | "failed";

export interface GeneratedRecommendationShelfDoc extends Document {
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
  createdAt: Date;
  updatedAt: Date;
}

const GeneratedRecommendationShelfSchema =
  new Schema<GeneratedRecommendationShelfDoc>(
    {
      userId: { type: String, required: true, trim: true, index: true },
      shelfKey: { type: String, required: true, trim: true, index: true },
      shelfTitle: { type: String, required: true, trim: true },
      status: {
        type: String,
        required: true,
        enum: ["generating", "completed", "failed"],
        default: "generating",
        index: true,
      },
      response: { type: Schema.Types.Mixed },
      generationId: { type: String, index: true },
      generationStartedAt: { type: Date, index: true },
      refreshGenerationId: { type: String, index: true },
      refreshStartedAt: { type: Date, index: true },
      completedAt: { type: Date, index: true },
      regenerateAfter: { type: Date, index: true },
      lastError: { type: String, default: "" },
    },
    { timestamps: true },
  );

GeneratedRecommendationShelfSchema.index(
  { userId: 1, shelfKey: 1 },
  { unique: true },
);

export const GeneratedRecommendationShelf: Model<GeneratedRecommendationShelfDoc> =
  (lumeyDB.models
    .GeneratedRecommendationShelf as Model<GeneratedRecommendationShelfDoc>) ||
  lumeyDB.model<GeneratedRecommendationShelfDoc>(
    "GeneratedRecommendationShelf",
    GeneratedRecommendationShelfSchema,
    "generatedrecommendationshelves",
  );
