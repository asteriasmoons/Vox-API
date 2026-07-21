import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

const challengeFollowSchema = new mongoose.Schema(
  {
    followerUserID: {
      type: String,
      required: true,
      index: true,
    },

    followingUserID: {
      type: String,
      required: true,
      index: true,
    },

    followedDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Prevent duplicate follows
challengeFollowSchema.index(
  {
    followerUserID: 1,
    followingUserID: 1,
  },
  {
    unique: true,
  },
);

// Prevent users from following themselves
challengeFollowSchema.pre("save", function (next) {
  if (this.followerUserID === this.followingUserID) {
    return next(new Error("Users cannot follow themselves."));
  }

  next();
});

export const LumeyChallengeFollow =
  lumeyDB.models.LumeyChallengeFollow ||
  lumeyDB.model(
    "LumeyChallengeFollow",
    challengeFollowSchema,
    "challengefollows",
  );
