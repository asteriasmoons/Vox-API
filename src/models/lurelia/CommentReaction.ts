import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const commentReactionSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    commentID: { type: String, default: "", index: true },
    replyID: { type: String, default: "", index: true },

    userID: { type: String, required: true, index: true },
    userDisplayName: { type: String, required: true, trim: true },

    kind: {
      type: String,
      enum: ["like", "heart", "celebrate", "laugh", "wow", "sad"],
      default: "like",
    },
  },
  { timestamps: true },
);

// One reaction per (user, comment or reply, kind).
commentReactionSchema.index(
  { commentID: 1, userID: 1, kind: 1 },
  { unique: true, partialFilterExpression: { commentID: { $ne: "" } } },
);
commentReactionSchema.index(
  { replyID: 1, userID: 1, kind: 1 },
  { unique: true, partialFilterExpression: { replyID: { $ne: "" } } },
);

commentReactionSchema.pre("validate", function (next) {
  const hasComment = typeof this.commentID === "string" && this.commentID.length > 0;
  const hasReply = typeof this.replyID === "string" && this.replyID.length > 0;
  if (hasComment === hasReply) {
    return next(new Error("Reaction must target exactly one of comment or reply."));
  }
  next();
});

export const LureliaCommentReaction =
  lureliaDB.models.LureliaCommentReaction ||
  lureliaDB.model(
    "LureliaCommentReaction",
    commentReactionSchema,
    "commentreactions",
  );
