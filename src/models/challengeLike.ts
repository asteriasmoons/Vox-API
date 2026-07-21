import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

const challengeLikeSchema = new mongoose.Schema(
  {
    feedItemID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LumeyChallengeFeedItem",
      required: true,
      index: true,
    },

    userID: {
      type: String,
      required: true,
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

challengeLikeSchema.index(
  {
    feedItemID: 1,
    userID: 1,
  },
  {
    unique: true,
  },
);

export const LumeyChallengeLike =
  lumeyDB.models.LumeyChallengeLike ||
  lumeyDB.model("LumeyChallengeLike", challengeLikeSchema, "challengelikes");
