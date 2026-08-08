import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const commentSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },
    eventPostID: { type: String, default: "", index: true },

    authorUserID: { type: String, required: true, index: true },
    authorDisplayName: { type: String, required: true, trim: true },
    authorAvatarURL: { type: String, default: "" },

    body: { type: String, required: true, trim: true, maxlength: 3000 },
    mentionedUserIDs: [{ type: String, index: true }],

    // Ordered list of `LureliaAttachment._id` strings. Comments reference
    // attachments — attachments are the source of truth for URL/mime.
    attachmentIDs: [{ type: String, index: true }],

    isPinned: { type: Boolean, default: false },
    likesCount: { type: Number, default: 0 },
    replyCount: { type: Number, default: 0 },

    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

commentSchema.index({ sharedEventID: 1, createdAt: -1 });
commentSchema.index({ eventPostID: 1, createdAt: -1 });

commentSchema.pre("validate", function (next) {
  if (!this.body || this.body.trim().length === 0) {
    return next(new Error("Comment body cannot be empty."));
  }
  next();
});

export const LureliaComment =
  lureliaDB.models.LureliaComment ||
  lureliaDB.model("LureliaComment", commentSchema, "comments");
