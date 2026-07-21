import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

const challengeCommentSchema = new mongoose.Schema(
  {
    feedItemID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LumeyChallengeFeedItem",
      required: true,
      index: true,
    },

    parentCommentID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LumeyChallengeComment",
      default: null,
      index: true,
    },

    userID: {
      type: String,
      required: true,
    },

    username: {
      type: String,
      required: true,
    },

    avatarName: {
      type: String,
      default: "",
      trim: true,
    },

    avatarURL: {
      type: String,
      default: "",
      trim: true,
    },

    text: {
      type: String,
      required: true,
      trim: true,
    },

    likeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    createdDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

challengeCommentSchema.index({ feedItemID: 1, createdDate: 1 });

export const LumeyChallengeComment =
  lumeyDB.models.LumeyChallengeComment ||
  lumeyDB.model(
    "LumeyChallengeComment",
    challengeCommentSchema,
    "challengecomments",
  );
