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

    validationStatus: {
      type: String,
      default: "submitted",
    },

    validationMessage: {
      type: String,
      default: "",
    },

    submittedDate: {
      type: Date,
      default: Date.now,
    },

    approvedDate: Date,

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

export const LumeyChallengeSubmission =
  lumeyDB.models.LumeyChallengeSubmission ||
  lumeyDB.model(
    "LumeyChallengeSubmission",
    challengeSubmissionSchema,
    "challengesubmissions",
  );
