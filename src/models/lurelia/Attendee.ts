import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const attendeeSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },

    userID: { type: String, required: true, index: true },
    displayName: { type: String, required: true, trim: true },
    avatarURL: { type: String, default: "" },

    role: {
      type: String,
      enum: ["host", "coHost", "member", "invited", "pending"],
      default: "member",
      index: true,
    },

    joinedAt: { type: Date, default: null },
    removedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },

    moderatorNote: { type: String, default: "" },
  },
  { timestamps: true },
);

attendeeSchema.index({ sharedEventID: 1, userID: 1 }, { unique: true });
attendeeSchema.index({ sharedEventID: 1, role: 1 });

export const LureliaAttendee =
  lureliaDB.models.LureliaAttendee ||
  lureliaDB.model("LureliaAttendee", attendeeSchema, "attendees");
