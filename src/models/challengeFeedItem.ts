import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

export type ChallengeFeedItemType = "submission" | "post";

const challengeFeedItemSchema = new mongoose.Schema(
  {
    feedType: {
      type: String,
      required: true,
      enum: ["submission", "post"],
      index: true,
    },

    // Used when feedType is "submission"
    submissionID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LumeyChallengeSubmission",
      default: null,
      index: true,
    },

    // Used when feedType is "post"
    postID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LumeyChallengePost",
      default: null,
      index: true,
    },

    userID: {
      type: String,
      required: true,
      index: true,
    },

    username: {
      type: String,
      required: true,
      trim: true,
    },

    // Optional challenge context for approved submission feed items
    challengeID: {
      type: String,
      default: "",
      index: true,
    },

    challengeTitle: {
      type: String,
      default: "",
      trim: true,
    },

    // Used by both approved submissions and normal user posts
    text: {
      type: String,
      default: "",
      trim: true,
    },

    // Optional hosted image URL for user-created feed posts.
    photoURL: {
      type: String,
      default: "",
      trim: true,
    },

    // Optional base64 encoded image data for user-created feed posts.
    photoBase64: {
      type: String,
      default: "",
    },

    likeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    commentCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    createdDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// A feed item should be either a submission item or a post item.
challengeFeedItemSchema.pre("validate", function (next) {
  if (this.feedType === "submission" && !this.submissionID) {
    return next(
      new Error("submissionID is required for submission feed items."),
    );
  }

  if (this.feedType === "post" && !this.postID) {
    return next(new Error("postID is required for post feed items."));
  }

  const hasPostText =
    typeof this.text === "string" && this.text.trim().length > 0;

  const hasPhotoURL =
    typeof this.photoURL === "string" && this.photoURL.trim().length > 0;

  const hasPhotoBase64 =
    typeof this.photoBase64 === "string" && this.photoBase64.trim().length > 0;

  if (
    this.feedType === "post" &&
    !hasPostText &&
    !hasPhotoURL &&
    !hasPhotoBase64
  ) {
    return next(new Error("Post feed items require text or a photo."));
  }

  next();
});

export const LumeyChallengeFeedItem =
  lumeyDB.models.LumeyChallengeFeedItem ||
  lumeyDB.model(
    "LumeyChallengeFeedItem",
    challengeFeedItemSchema,
    "challengefeeditems",
  );
