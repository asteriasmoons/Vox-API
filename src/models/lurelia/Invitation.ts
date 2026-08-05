import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const invitationSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },
    inviteToken: { type: String, required: true, unique: true, index: true },

    senderUserID: { type: String, required: true, index: true },
    senderDisplayName: { type: String, required: true, trim: true },

    recipientUserID: { type: String, default: "", index: true },
    recipientDisplayName: { type: String, default: "" },
    recipientEmail: { type: String, default: "", index: true },

    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "expired", "revoked"],
      default: "pending",
      index: true,
    },
    channel: {
      type: String,
      enum: ["inApp", "email", "link", "shareSheet", "qrCode"],
      default: "inApp",
    },

    message: { type: String, default: "", maxlength: 1000 },
    sentAt: { type: Date, default: Date.now, index: true },
    respondedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

invitationSchema.index({ sharedEventID: 1, status: 1 });
invitationSchema.index({ recipientUserID: 1, status: 1 });

export const LureliaInvitation =
  lureliaDB.models.LureliaInvitation ||
  lureliaDB.model("LureliaInvitation", invitationSchema, "invitations");
