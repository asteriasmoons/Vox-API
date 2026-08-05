import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const eventArtworkSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },

    url: { type: String, required: true, trim: true },
    thumbnailURL: { type: String, default: "" },
    bannerURL: { type: String, default: "" },

    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },

    uploaderUserID: { type: String, required: true, index: true },
    altText: { type: String, default: "" },

    isPrimary: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Only one primary artwork per event.
eventArtworkSchema.index(
  { sharedEventID: 1, isPrimary: 1 },
  {
    unique: true,
    partialFilterExpression: { isPrimary: true },
  },
);

export const LureliaEventArtwork =
  lureliaDB.models.LureliaEventArtwork ||
  lureliaDB.model("LureliaEventArtwork", eventArtworkSchema, "eventartwork");
