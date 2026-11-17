// src/models/SprintMessage.ts

import { lumeyDB } from "../config/databases";
import mongoose, { Schema, Document, Model } from "mongoose";

export type SprintMessageType = "text" | "system" | "sprint_result";

export interface ISprintMessage extends Document {
  senderUserId: string;
  senderDisplayName: string;
  type: SprintMessageType;
  text: string;
  sprintId: string | null;
  resultPayload: unknown | null; // serialised leaderboard for sprint_result type
  createdAt: Date;
  updatedAt: Date;
}

const SprintMessageSchema = new Schema<ISprintMessage>(
  {
    senderUserId: { type: String, required: true },
    senderDisplayName: { type: String, required: true },
    type: {
      type: String,
      enum: ["text", "system", "sprint_result"],
      default: "text",
    },
    text: { type: String, required: true },
    sprintId: { type: String, default: null },
    resultPayload: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const SprintMessage: Model<ISprintMessage> =
  (lumeyDB.models.SprintMessage as Model<ISprintMessage>) ||
  lumeyDB.model<ISprintMessage>("SprintMessage", SprintMessageSchema);
