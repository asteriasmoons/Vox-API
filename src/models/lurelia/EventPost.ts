import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const eventPostSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },

    authorUserID: { type: String, required: true, index: true },
    authorDisplayName: { type: String, required: true, trim: true },
    authorAvatarURL: { type: String, default: "" },

    bodyMarkdown: { type: String, required: true, trim: true, maxlength: 20000 },
    bodyHTML: { type: String, default: "" },

    isPinned: { type: Boolean, default: false },
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },

    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    notificationSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

eventPostSchema.index({ sharedEventID: 1, isPinned: -1, createdAt: -1 });

eventPostSchema.pre("validate", function (next) {
  if (!this.bodyMarkdown || this.bodyMarkdown.trim().length === 0) {
    return next(new Error("Post body cannot be empty."));
  }
  next();
});

export const LureliaEventPost =
  lureliaDB.models.LureliaEventPost ||
  lureliaDB.model("LureliaEventPost", eventPostSchema, "eventposts");
