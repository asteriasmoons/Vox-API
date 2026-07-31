import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

const challengeSubmissionSchema = new mongoose.Schema(
  {
    challengeID: { type: String, required: true },
    entryID: { type: String, default: "" },

    userID: { type: String, required: true },
    username: { type: String, required: true },

    linkedBookIDs: [{ type: String }],
    linkedSessionIDs: [{ type: String }],
    linkedReviewIDs: [{ type: String }],
    linkedReadingListIDs: [{ type: String }],

    submissionNote: { type: String, default: "" },
    proofSummary: { type: String, default: "" },
    photoURL: {
      type: String,
      default: "",
      trim: true,
    },

    validationStatus: {
      type: String,
      default: "submitted",
    },

    validationMessage: {
      type: String,
      default: "",
    },

    photoValidationStatus: {
      type: String,
      default: "",
    },

    photoValidationMessage: {
      type: String,
      default: "",
    },

    photoValidationConfidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },

    photoValidationJSON: {
      type: String,
      default: "",
    },

    submittedDate: {
      type: Date,
      default: Date.now,
    },

    approvedDate: Date,

    cycleID: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    cycleStartDate: Date,
    cycleEndDate: Date,

    postedToFeed: {
      type: Boolean,
      default: false,
    },

    feedItemID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LumeyChallengeFeedItem",
      default: null,
      index: true,
    },

    likeCount: {
      type: Number,
      default: 0,
    },

    commentCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

challengeSubmissionSchema.index({
  challengeID: 1,
  userID: 1,
  cycleID: 1,
  validationStatus: 1,
});

export const LumeyChallengeSubmission =
  lumeyDB.models.LumeyChallengeSubmission ||
  lumeyDB.model(
    "LumeyChallengeSubmission",
    challengeSubmissionSchema,
    "challengesubmissions",
  );
