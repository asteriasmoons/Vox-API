import mongoose from "mongoose";
import { lureliaDB } from "../../config/databases";

const notificationSubscriptionSchema = new mongoose.Schema(
  {
    localID: { type: String, required: true, unique: true, index: true },
    sharedEventID: { type: String, required: true, index: true },

    userID: { type: String, required: true, index: true },
    deviceToken: { type: String, required: true, index: true },
    platform: {
      type: String,
      enum: ["ios", "android", "web"],
      default: "ios",
    },

    enabledKinds: [
      {
        type: String,
        enum: [
          "invitation",
          "join",
          "hostPost",
          "comment",
          "reply",
          "announcement",
          "edit",
          "cancellation",
          "timeChanged",
          "locationChanged",
          "rsvpChanged",
          "ownershipTransferred",
        ],
      },
    ],

    subscribedAt: { type: Date, default: Date.now },
    unsubscribedAt: { type: Date, default: null },
    lastPingedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSubscriptionSchema.index(
  { sharedEventID: 1, userID: 1, deviceToken: 1 },
  { unique: true },
);

export const LureliaNotificationSubscription =
  lureliaDB.models.LureliaNotificationSubscription ||
  lureliaDB.model(
    "LureliaNotificationSubscription",
    notificationSubscriptionSchema,
    "notificationsubscriptions",
  );
