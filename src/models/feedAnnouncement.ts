import mongoose from "mongoose";
import { lumeyDB } from "../config/databases";

const feedAnnouncementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
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

    avatarURL: {
      type: String,
      default: "",
      trim: true,
    },

    avatarName: {
      type: String,
      default: "",
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
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

export const LumeyFeedAnnouncement =
  lumeyDB.models.LumeyFeedAnnouncement ||
  lumeyDB.model(
    "LumeyFeedAnnouncement",
    feedAnnouncementSchema,
    "feedannouncement",
  );
