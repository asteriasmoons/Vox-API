import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

const challengeProfileSchema = new mongoose.Schema(
  {
    userID: {
      type: String,
      required: true,
      unique: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    avatarName: {
      type: String,
      default: "",
    },
    avatarURL: {
      type: String,

      default: "",
    },

    bio: {
      type: String,
      default: "",
    },

    favoriteGenre: {
      type: String,
      default: "",
    },

    readingStreak: {
      type: Number,
      default: 0,
    },

    challengePoints: {
      type: Number,
      default: 0,
    },

    challengesCompleted: {
      type: Number,
      default: 0,
    },

    followersCount: {
      type: Number,
      default: 0,
    },

    followingCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

export const LumeyChallengeProfile =
  lumeyDB.models.LumeyChallengeProfile ||
  lumeyDB.model(
    "LumeyChallengeProfile",
    challengeProfileSchema,
    "challengeprofiles",
  );
