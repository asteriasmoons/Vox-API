import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const attachmentSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },
    eventPostID: { type: String, default: "", index: true },
    announcementID: { type: String, default: "", index: true },

    kind: {
      type: String,
      enum: ["image", "file", "video", "audio"],
      default: "image",
    },

    url: { type: String, required: true, trim: true },
    thumbnailURL: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    filename: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0 },

    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },

    uploaderUserID: { type: String, required: true, index: true },
    caption: { type: String, default: "", trim: true, maxlength: 500 },

    isInline: { type: Boolean, default: false },
  },
  { timestamps: true },
);

attachmentSchema.index({ sharedEventID: 1, createdAt: -1 });

export const LureliaAttachment =
  lureliaDB.models.LureliaAttachment ||
  lureliaDB.model("LureliaAttachment", attachmentSchema, "attachments");
