import mongoose from "mongoose";

const lumeyChallengeFollowSchema = new mongoose.Schema(
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
lumeyChallengeFollowSchema.index(
  {
    followerUserID: 1,
    followingUserID: 1,
  },
  {
    unique: true,
  },
);

// Prevent users from following themselves
lumeyChallengeFollowSchema.pre("save", function (next) {
  if (this.followerUserID === this.followingUserID) {
    return next(new Error("Users cannot follow themselves."));
  }

  next();
});

export const LumeyChallengeFollow = mongoose.model(
  "LumeyChallengeFollow",
  lumeyChallengeFollowSchema,
);
