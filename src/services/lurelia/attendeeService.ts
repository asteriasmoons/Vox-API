// src/services/lurelia/attendeeService.ts

import type { Model } from "mongoose";
import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";

import { LureliaAttendee as AttendeeRaw } from "../../models/lurelia/Attendee";
import { LureliaHost as HostRaw } from "../../models/lurelia/Host";
import { LureliaSharedEvent as SharedEventRaw } from "../../models/lurelia/SharedEvent";
import { LureliaPermissions as PermissionsRaw } from "../../models/lurelia/Permissions";

import { eventRoomName } from "./sharedEventService";
import { dispatchNotification } from "./notificationService";

const Attendee = AttendeeRaw as Model<any>;
const Host = HostRaw as Model<any>;
const SharedEvent = SharedEventRaw as Model<any>;
const Permissions = PermissionsRaw as Model<any>;

export async function listAttendees(sharedEventID: string) {
  return await Attendee.find({ sharedEventID, removedAt: null })
    .sort({ role: 1, displayName: 1 })
    .lean();
}

export async function searchAttendees(sharedEventID: string, query: string) {
  const q = String(query || "").trim();
  const filter: Record<string, unknown> = { sharedEventID, removedAt: null };
  if (q.length > 0) {
    filter.displayName = { $regex: q, $options: "i" };
  }
  return await Attendee.find(filter)
    .sort({ displayName: 1 })
    .limit(200)
    .lean();
}

export async function joinEvent(
  io: SocketIOServer,
  sharedEventID: string,
  userID: string,
  displayName: string,
  avatarURL: string = "",
) {
  const perms = await Permissions.findOne({ sharedEventID }).lean<any>();
  const requiresApproval = perms?.requireApprovalToJoin === true;

  const existing = await Attendee.findOne({ sharedEventID, userID });
  if (existing) {
    if (existing.removedAt) {
      existing.removedAt = null;
      existing.role = requiresApproval ? "pending" : "member";
      existing.joinedAt = requiresApproval ? existing.joinedAt : new Date();
      await existing.save();
    }
    io.to(eventRoomName(sharedEventID)).emit(
      "event:attendee_joined",
      existing.toObject(),
    );
    return existing.toObject();
  }

  const created = await Attendee.create({
    localID: randomUUID(),
    sharedEventID,
    userID,
    displayName,
    avatarURL,
    role: requiresApproval ? "pending" : "member",
    joinedAt: requiresApproval ? null : new Date(),
  });

  await SharedEvent.findByIdAndUpdate(sharedEventID, {
    $inc: { "counts.attendees": requiresApproval ? 0 : 1 },
  });

  io.to(eventRoomName(sharedEventID)).emit(
    "event:attendee_joined",
    created.toObject(),
  );

  await dispatchNotification({
    sharedEventID,
    kind: "join",
    payload: {
      attendeeUserID: userID,
      actorName: displayName,
    },
  });

  return created.toObject();
}

export async function approveJoinRequest(
  io: SocketIOServer,
  sharedEventID: string,
  actorUserID: string,
  targetUserID: string,
) {
  await assertActorCanModerate(sharedEventID, actorUserID);
  const attendee = await Attendee.findOne({
    sharedEventID,
    userID: targetUserID,
    role: "pending",
    removedAt: null,
  });
  if (!attendee) throw new Error("REQUEST_NOT_FOUND");
  attendee.role = "member";
  attendee.joinedAt = new Date();
  await attendee.save();
  await SharedEvent.findByIdAndUpdate(sharedEventID, {
    $inc: { "counts.attendees": 1 },
  });
  io.to(eventRoomName(sharedEventID)).emit(
    "event:attendee_approved",
    attendee.toObject(),
  );
  return attendee.toObject();
}

export async function leaveEvent(
  io: SocketIOServer,
  sharedEventID: string,
  userID: string,
) {
  const attendee = await Attendee.findOne({ sharedEventID, userID });
  if (!attendee || attendee.removedAt) throw new Error("NOT_A_MEMBER");
  if (attendee.role === "host") throw new Error("HOST_CANNOT_LEAVE_TRANSFER_FIRST");
  attendee.removedAt = new Date();
  await attendee.save();
  await SharedEvent.findByIdAndUpdate(sharedEventID, {
    $inc: { "counts.attendees": -1 },
  });
  io.to(eventRoomName(sharedEventID)).emit(
    "event:attendee_left",
    attendee.toObject(),
  );
  return attendee.toObject();
}

export async function removeAttendee(
  io: SocketIOServer,
  sharedEventID: string,
  actorUserID: string,
  targetUserID: string,
) {
  await assertActorCanModerate(sharedEventID, actorUserID);
  if (actorUserID === targetUserID) throw new Error("CANNOT_REMOVE_SELF");
  const attendee = await Attendee.findOne({
    sharedEventID,
    userID: targetUserID,
    removedAt: null,
  });
  if (!attendee) throw new Error("ATTENDEE_NOT_FOUND");
  if (attendee.role === "host") throw new Error("CANNOT_REMOVE_HOST");
  attendee.removedAt = new Date();
  await attendee.save();
  await SharedEvent.findByIdAndUpdate(sharedEventID, {
    $inc: { "counts.attendees": -1 },
  });
  io.to(eventRoomName(sharedEventID)).emit(
    "event:attendee_removed",
    attendee.toObject(),
  );
  return attendee.toObject();
}

export async function transferOwnership(
  io: SocketIOServer,
  sharedEventID: string,
  currentHostUserID: string,
  newHostUserID: string,
) {
  const oldHostAttendee = await Attendee.findOne({
    sharedEventID,
    userID: currentHostUserID,
    role: "host",
    removedAt: null,
  });
  if (!oldHostAttendee) throw new Error("FORBIDDEN");

  const newHostAttendee = await Attendee.findOne({
    sharedEventID,
    userID: newHostUserID,
    removedAt: null,
  });
  if (!newHostAttendee) throw new Error("NEW_HOST_NOT_ATTENDEE");

  // Update Attendee roles.
  oldHostAttendee.role = "coHost";
  await oldHostAttendee.save();
  newHostAttendee.role = "host";
  await newHostAttendee.save();

  // Update Host audit rows.
  await Host.updateMany(
    { sharedEventID, isPrimary: true, isFormer: false },
    {
      isPrimary: false,
      isFormer: true,
      relinquishedAt: new Date(),
      transferredToUserID: newHostUserID,
    },
  );
  await Host.create({
    localID: randomUUID(),
    sharedEventID,
    userID: newHostUserID,
    displayName: newHostAttendee.displayName,
    avatarURL: newHostAttendee.avatarURL,
    isPrimary: true,
    isFormer: false,
  });

  await SharedEvent.findByIdAndUpdate(sharedEventID, {
    hostUserID: newHostUserID,
    hostDisplayName: newHostAttendee.displayName,
    hostAvatarURL: newHostAttendee.avatarURL,
  });

  io.to(eventRoomName(sharedEventID)).emit("event:ownership_transferred", {
    sharedEventID,
    newHostUserID,
    oldHostUserID: currentHostUserID,
  });

  return { sharedEventID, newHostUserID, oldHostUserID: currentHostUserID };
}

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
