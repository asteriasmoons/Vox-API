import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const announcementSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },

    authorUserID: { type: String, required: true, index: true },
    authorDisplayName: { type: String, required: true, trim: true },
    authorAvatarURL: { type: String, default: "" },

    bodyMarkdown: { type: String, required: true, trim: true, maxlength: 10000 },
    bodyHTML: { type: String, default: "" },

    isPinned: { type: Boolean, default: true },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    notificationSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

announcementSchema.index({ sharedEventID: 1, createdAt: -1 });

announcementSchema.pre("validate", function (next) {
  if (!this.bodyMarkdown || this.bodyMarkdown.trim().length === 0) {
    return next(new Error("Announcement body cannot be empty."));
  }
  next();
});

export const LureliaAnnouncement =
  lureliaDB.models.LureliaAnnouncement ||
  lureliaDB.model("LureliaAnnouncement", announcementSchema, "announcements");
