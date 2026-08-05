import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const sharedEventSchema = new mongoose.Schema(
  {
    // Client-generated local UUID; server keeps its own _id.
    localID: { type: String, required: true, unique: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", trim: true, maxlength: 5000 },
    iconName: { type: String, default: "", trim: true },
    colorHex: { type: String, default: "#03dbfc", trim: true },
    timezoneIdentifier: { type: String, default: "UTC", trim: true },

    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, default: null },
    isAllDay: { type: Boolean, default: false },

    locationName: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },

    visibility: {
      type: String,
      enum: ["private", "link", "public"],
      default: "private",
      index: true,
    },
    inviteToken: { type: String, default: "", index: true },
    shareCode: { type: String, default: "", index: true },

    hostUserID: { type: String, required: true, index: true },
    hostDisplayName: { type: String, required: true, trim: true },
    hostAvatarURL: { type: String, default: "" },

    calendarIDs: [{ type: String, index: true }],

    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: "" },

    // Aggregate counters kept in sync by service layer.
    counts: {
      going: { type: Number, default: 0 },
      interested: { type: Number, default: 0 },
      declined: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
      attendees: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      posts: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

sharedEventSchema.index({ hostUserID: 1, startDate: -1 });
sharedEventSchema.index({ visibility: 1, startDate: -1 });

export const LureliaSharedEvent =
  lureliaDB.models.LureliaSharedEvent ||
  lureliaDB.model("LureliaSharedEvent", sharedEventSchema, "sharedevents");
