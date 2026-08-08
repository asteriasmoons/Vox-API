// src/services/lurelia/permissionsService.ts
//
// Host/co-host updates to the per-event Permissions doc. Ownership +
// moderation checks live in the attendee service — this file only
// coordinates the write.

import type { Model } from "mongoose";
import { Server as SocketIOServer } from "socket.io";

import { LureliaPermissions as PermissionsRaw } from "../../models/lurelia/Permissions";
import { LureliaAttendee as AttendeeRaw } from "../../models/lurelia/Attendee";
import { eventRoomName } from "./sharedEventService";

const Permissions = PermissionsRaw as Model<any>;
const Attendee = AttendeeRaw as Model<any>;

async function assertActorCanModerate(
  sharedEventID: string,
  actorUserID: string,
) {
  const attendee = await Attendee.findOne({
    sharedEventID,
    userID: actorUserID,
    role: { $in: ["host", "coHost"] },
    removedAt: null,
  }).lean<any>();
  if (!attendee) throw new Error("FORBIDDEN");
}

export async function getPermissions(sharedEventID: string) {
  const perms = await Permissions.findOne({ sharedEventID }).lean<any>();
  if (!perms) throw new Error("PERMISSIONS_NOT_FOUND");
  return perms;
}

export type PermissionsPatch = Partial<{
  allowGuestPosts: boolean;
  allowGuestInvites: boolean;
  allowComments: boolean;
  allowRSVPChanges: boolean;
  requireApprovalToJoin: boolean;
  showAttendeeList: boolean;
  allowDeclinedComments: boolean;
}>;

export async function updatePermissions(
  io: SocketIOServer,
  sharedEventID: string,
  actorUserID: string,
  patch: PermissionsPatch,
) {
  await assertActorCanModerate(sharedEventID, actorUserID);
  const updated = await Permissions.findOneAndUpdate(
    { sharedEventID },
    { $set: patch },
    { new: true },
  ).lean();
  if (!updated) throw new Error("PERMISSIONS_NOT_FOUND");
  io.to(eventRoomName(sharedEventID)).emit("event:permissions_updated", updated);
  return updated;
}

/**
 * Convenience toggle for the "lock discussion" host affordance. Sets
 * `allowComments` and — when locking — also flips `allowDeclinedComments`
 * to false so a re-open later is a single-decision change.
 */
export async function setDiscussionLocked(
  io: SocketIOServer,
  sharedEventID: string,
  actorUserID: string,
  locked: boolean,
) {
  return await updatePermissions(io, sharedEventID, actorUserID, {
    allowComments: !locked,
    ...(locked ? { allowDeclinedComments: false } : {}),
  });
}
