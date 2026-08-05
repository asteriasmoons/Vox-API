import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const hostSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },

    userID: { type: String, required: true, index: true },
    displayName: { type: String, required: true, trim: true },
    avatarURL: { type: String, default: "" },

    isPrimary: { type: Boolean, default: false },
    isFormer: { type: Boolean, default: false },

    appointedAt: { type: Date, default: Date.now },
    relinquishedAt: { type: Date, default: null },
    transferredToUserID: { type: String, default: "" },
  },
  { timestamps: true },
);

hostSchema.index({ sharedEventID: 1, userID: 1, isFormer: 1 });
// Only one active primary host per event.
hostSchema.index(
  { sharedEventID: 1, isPrimary: 1 },
  {
    unique: true,
    partialFilterExpression: { isPrimary: true, isFormer: false },
  },
);

export const LureliaHost =
  lureliaDB.models.LureliaHost ||
  lureliaDB.model("LureliaHost", hostSchema, "hosts");
