import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

const directMessageSchema = new mongoose.Schema(
  {
    conversationID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LumeyConversation",
      required: true,
      index: true,
    },

    senderUserID: {
      type: String,
      required: true,
      index: true,
    },

    senderUsername: {
      type: String,
      required: true,
    },

    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    createdDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

directMessageSchema.index({ conversationID: 1, createdDate: 1 });

export const LumeyDirectMessage =
  lumeyDB.models.LumeyDirectMessage ||
  lumeyDB.model("LumeyDirectMessage", directMessageSchema, "directmessage");
