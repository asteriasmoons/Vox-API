import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const permissionsSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, unique: true, index: true },

    allowGuestPosts: { type: Boolean, default: false },
    allowGuestInvites: { type: Boolean, default: false },
    allowComments: { type: Boolean, default: true },
    allowRSVPChanges: { type: Boolean, default: true },
    requireApprovalToJoin: { type: Boolean, default: false },
    showAttendeeList: { type: Boolean, default: true },
    allowDeclinedComments: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const LureliaPermissions =
  lureliaDB.models.LureliaPermissions ||
  lureliaDB.model("LureliaPermissions", permissionsSchema, "permissions");
