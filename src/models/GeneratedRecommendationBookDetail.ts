import { Schema, Document, Model } from "mongoose";
import { lumeyDB } from "../config/databases";
import type { RecommendationBookDetailResponse } from "../services/recommendationBookDetailService";

export interface GeneratedRecommendationBookDetailDoc extends Document {
  bookKey: string;
  cacheVersion: number;
  title: string;
  author: string;
  response: RecommendationBookDetailResponse;
  createdAt: Date;
  updatedAt: Date;
}

const GeneratedRecommendationBookDetailSchema =
  new Schema<GeneratedRecommendationBookDetailDoc>(
    {
      bookKey: { type: String, required: true, trim: true, unique: true, index: true },
      cacheVersion: { type: Number, required: true, default: 1, index: true },
      title: { type: String, required: true, trim: true, index: true },
      author: { type: String, required: true, trim: true, index: true },
      response: { type: Schema.Types.Mixed, required: true },
    },
    { timestamps: true },
  );

export const GeneratedRecommendationBookDetail: Model<GeneratedRecommendationBookDetailDoc> =
  (lumeyDB.models
    .GeneratedRecommendationBookDetail as Model<GeneratedRecommendationBookDetailDoc>) ||
  lumeyDB.model<GeneratedRecommendationBookDetailDoc>(
    "GeneratedRecommendationBookDetail",
    GeneratedRecommendationBookDetailSchema,
    "generatedrecommendationbookdetails",
  );
