// src/models/BuddyMessage.ts

import { lumeyDB } from "../config/databases";
import mongoose, { Schema, Document, Model } from "mongoose";

export type BuddyMessageType = "text" | "progress_update" | "system";

export interface IBuddyMessage extends Document {
  groupId: string;
  senderUserId: string;
  senderDisplayName: string;

  type: BuddyMessageType;
  text: string;

  // for progress_update type — optional structured data
  progressChapter: number | null;
  progressPage: number | null;

  createdAt: Date;
  updatedAt: Date;
}

const BuddyMessageSchema = new Schema<IBuddyMessage>(
  {
    groupId: { type: String, required: true, index: true },
    senderUserId: { type: String, required: true },
    senderDisplayName: { type: String, required: true },

    type: {
      type: String,
      enum: ["text", "progress_update", "system"],
      default: "text",
    },
    text: { type: String, required: true },

    progressChapter: { type: Number, default: null },
    progressPage: { type: Number, default: null },
  },
  {
    timestamps: true,
  },
);

export const BuddyMessage: Model<IBuddyMessage> =
  lumeyDB.models.BuddyMessage ||
  lumeyDB.model<IBuddyMessage>("BuddyMessage", BuddyMessageSchema, "buddymessages");
