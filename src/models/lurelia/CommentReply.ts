import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const commentReplySchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    parentCommentID: { type: String, required: true, index: true },
    sharedEventID: { type: String, required: true, index: true },

    authorUserID: { type: String, required: true, index: true },
    authorDisplayName: { type: String, required: true, trim: true },
    authorAvatarURL: { type: String, default: "" },

    body: { type: String, required: true, trim: true, maxlength: 3000 },
    mentionedUserIDs: [{ type: String, index: true }],

    likesCount: { type: Number, default: 0 },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

commentReplySchema.index({ parentCommentID: 1, createdAt: 1 });

commentReplySchema.pre("validate", function (next) {
  if (!this.body || this.body.trim().length === 0) {
    return next(new Error("Reply body cannot be empty."));
  }
  next();
});

export const LureliaCommentReply =
  lureliaDB.models.LureliaCommentReply ||
  lureliaDB.model(
    "LureliaCommentReply",
    commentReplySchema,
    "commentreplies",
  );
