import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

const conversationSchema = new mongoose.Schema(
  {
    // Sorted pair of userIDs for unique constraint
    participantA: {
      type: String,
      required: true,
      index: true,
    },

    participantB: {
      type: String,
      required: true,
      index: true,
    },

    // Denormalized for list display
    participantAUsername: {
      type: String,
      default: "",
    },

    participantBUsername: {
      type: String,
      default: "",
    },

    lastMessageText: {
      type: String,
      default: "",
    },

    lastMessageSenderUserID: {
      type: String,
      default: "",
    },

    lastMessageDate: {
      type: Date,
      default: Date.now,
    },

    // Per-participant unread counts
    unreadCountA: {
      type: Number,
      default: 0,
      min: 0,
    },

    unreadCountB: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

// One conversation per unique pair
conversationSchema.index(
  { participantA: 1, participantB: 1 },
  { unique: true },
);

export const LumeyConversation =
  lumeyDB.models.LumeyConversation ||
  lumeyDB.model("LumeyConversation", conversationSchema, "conversation");
