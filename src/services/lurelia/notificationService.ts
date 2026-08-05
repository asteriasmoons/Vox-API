// src/services/lurelia/notificationService.ts
//
// Subscription management and fan-out dispatch. Actual APNs push delivery
// is intentionally split into a `deliver()` seam so future adapters (APNs
// via node-apn, FCM, web push) can slot in without changing callers.

import type { Model } from "mongoose";
import { randomUUID } from "crypto";

import { LureliaNotificationSubscription as SubscriptionRaw } from "../../models/lurelia/NotificationSubscription";

const Subscription = SubscriptionRaw as Model<any>;

export type NotificationKind =
  | "invitation"
  | "join"
  | "hostPost"
  | "comment"
  | "reply"
  | "announcement"
  | "edit"
  | "cancellation"
  | "timeChanged"
  | "locationChanged"
  | "rsvpChanged"
  | "ownershipTransferred";

export type SubscribeInput = {
  sharedEventID: string;
  userID: string;
  deviceToken: string;
  platform?: "ios" | "android" | "web";
  enabledKinds?: NotificationKind[];
};

const ALL_KINDS: NotificationKind[] = [
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
];

export async function subscribe(input: SubscribeInput) {
  const doc = await Subscription.findOneAndUpdate(
    {
      sharedEventID: input.sharedEventID,
      userID: input.userID,
      deviceToken: input.deviceToken,
    },
    {
      $set: {
        platform: input.platform ?? "ios",
        enabledKinds: input.enabledKinds ?? ALL_KINDS,
        unsubscribedAt: null,
      },
      $setOnInsert: {
        localID: randomUUID(),
        subscribedAt: new Date(),
      },
    },
    { new: true, upsert: true },
  );
  return doc.toObject();
}

export async function unsubscribe(
  sharedEventID: string,
  userID: string,
  deviceToken: string,
) {
  const doc = await Subscription.findOneAndUpdate(
    { sharedEventID, userID, deviceToken },
    { $set: { unsubscribedAt: new Date() } },
    { new: true },
  );
  if (!doc) throw new Error("SUBSCRIPTION_NOT_FOUND");
  return doc.toObject();
}

export async function updatePreferences(
  sharedEventID: string,
  userID: string,
  deviceToken: string,
  enabledKinds: NotificationKind[],
) {
  const doc = await Subscription.findOneAndUpdate(
    { sharedEventID, userID, deviceToken },
    { $set: { enabledKinds } },
    { new: true },
  );
  if (!doc) throw new Error("SUBSCRIPTION_NOT_FOUND");
  return doc.toObject();
}

export async function listSubscriptions(sharedEventID: string) {
  return await Subscription.find({
    sharedEventID,
    unsubscribedAt: null,
  }).lean();
}

export type DispatchInput = {
  sharedEventID: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
};

/**
 * Fan out a notification to every active subscription that has opted into
 * this kind. Delivery to APNs / FCM happens via `deliver()`; for now that
 * seam logs and returns — Phase 1A.7 wires the real APNs adapter.
 */
export async function dispatchNotification(input: DispatchInput) {
  const subscriptions = await Subscription.find({
    sharedEventID: input.sharedEventID,
    unsubscribedAt: null,
    enabledKinds: input.kind,
  }).lean();

  await Promise.all(
    subscriptions.map((sub) =>
      deliver(sub.deviceToken, sub.platform, input.kind, input.payload).catch(
        (err) => {
          console.error(
            `[lurelia] notification deliver failed for ${sub.deviceToken}:`,
            err,
          );
        },
      ),
    ),
  );
  return { dispatched: subscriptions.length };
}

async function deliver(
  deviceToken: string,
  platform: string,
  kind: NotificationKind,
  payload: Record<string, unknown>,
) {
  // Seam. APNs / FCM adapter is wired in Phase 1A.7.
  console.log(
    `[lurelia] notify ${platform} ${deviceToken.slice(0, 8)}… ${kind}`,
    payload,
  );
}
