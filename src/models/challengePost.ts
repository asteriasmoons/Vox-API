import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

const challengePostSchema = new mongoose.Schema(
  {
    userID: {
      type: String,
      required: true,
      index: true,
    },

    // Username at time of posting (useful for display/search).
    // Avatar comes from LumeyChallengeProfile.
    username: {
      type: String,
      required: true,
      trim: true,
    },

    // Main body of the post
    text: {
      type: String,
      default: "",
      trim: true,
      maxlength: 3000,
    },

    // Uploaded image URL (optional)
    photoURL: {
      type: String,
      default: "",
      trim: true,
    },

    // Base64 encoded image data
    photoBase64: {
      type: String,
      default: "",
    },

    // Optional image caption
    photoCaption: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    // Optional linked book from the user's library
    linkedBookID: {
      type: String,
      default: "",
      index: true,
    },

    // Optional linked challenge
    linkedChallengeID: {
      type: String,
      default: "",
      index: true,
    },

    // Optional mood
    mood: {
      type: String,
      default: "",
      trim: true,
    },

    // Marks whether this post contains spoilers
    containsSpoilers: {
      type: Boolean,
      default: false,
    },

    // Who can see the post
    visibility: {
      type: String,
      enum: ["public", "followers"],
      default: "public",
    },

    createdDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    editedDate: {
      type: Date,
      default: null,
    },

    isEdited: {
      type: Boolean,
      default: false,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Every post must contain either text, a photo, or both.
challengePostSchema.pre("validate", function (next) {
  const hasText = typeof this.text === "string" && this.text.trim().length > 0;

  const hasPhotoURL =
    typeof this.photoURL === "string" && this.photoURL.trim().length > 0;

  const hasPhotoBase64 =
    typeof this.photoBase64 === "string" &&
    this.photoBase64.trim().length > 0;

  if (!hasText && !hasPhotoURL && !hasPhotoBase64) {
    return next(new Error("A post must contain text, a photo, or both."));
  }

  next();
});

export const LumeyChallengePost =
  lumeyDB.models.LumeyChallengePost ||
  lumeyDB.model("LumeyChallengePost", challengePostSchema, "challengeposts");
