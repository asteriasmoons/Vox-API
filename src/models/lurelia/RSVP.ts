import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const rsvpSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },

    userID: { type: String, required: true, index: true },
    displayName: { type: String, required: true, trim: true },
    avatarURL: { type: String, default: "" },

    status: {
      type: String,
      enum: ["going", "interested", "declined", "pending"],
      default: "pending",
      index: true,
    },

    note: { type: String, default: "", trim: true, maxlength: 500 },
    plusOneCount: { type: Number, default: 0, min: 0, max: 20 },
  },
  { timestamps: true },
);

// One RSVP per (event, user).
rsvpSchema.index({ sharedEventID: 1, userID: 1 }, { unique: true });
rsvpSchema.index({ sharedEventID: 1, status: 1 });

export const LureliaRSVP =
  lureliaDB.models.LureliaRSVP ||
  lureliaDB.model("LureliaRSVP", rsvpSchema, "rsvps");
