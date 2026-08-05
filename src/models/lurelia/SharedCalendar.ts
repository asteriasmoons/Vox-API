import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const sharedCalendarSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", trim: true, maxlength: 1000 },
    colorHex: { type: String, default: "#03dbfc", trim: true },
    iconName: { type: String, default: "", trim: true },

    ownerUserID: { type: String, required: true, index: true },
    memberUserIDs: [{ type: String, index: true }],

    visibility: {
      type: String,
      enum: ["private", "link", "public"],
      default: "private",
      index: true,
    },

    isHidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);

sharedCalendarSchema.index({ ownerUserID: 1, name: 1 });

export const LureliaSharedCalendar =
  lureliaDB.models.LureliaSharedCalendar ||
  lureliaDB.model(
    "LureliaSharedCalendar",
    sharedCalendarSchema,
    "sharedcalendars",
  );
