// src/services/lurelia/sharedEventService.ts
//
// Core CRUD for SharedEvent + counter maintenance. All socket emits happen
// on the `event:<sharedEventID>` room. See routes/lurelia/index.ts for the
// join / leave handlers that put clients in that room.

import type { Model } from "mongoose";
import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";

import { LureliaSharedEvent as SharedEventRaw } from "../../models/lurelia/SharedEvent";
import { LureliaHost as HostRaw } from "../../models/lurelia/Host";
import { LureliaPermissions as PermissionsRaw } from "../../models/lurelia/Permissions";
import { LureliaAttendee as AttendeeRaw } from "../../models/lurelia/Attendee";

const SharedEvent = SharedEventRaw as Model<any>;
const Host = HostRaw as Model<any>;
const Permissions = PermissionsRaw as Model<any>;
const Attendee = AttendeeRaw as Model<any>;

export type CreateSharedEventInput = {
  localID: string;
  title: string;
  description?: string;
  iconName?: string;
  colorHex?: string;
  timezoneIdentifier?: string;
  startDate: Date | string;
  endDate?: Date | string | null;
  isAllDay?: boolean;
  locationName?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  visibility?: "private" | "link" | "public";
  hostUserID: string;
  hostDisplayName: string;
  hostAvatarURL?: string;
  calendarIDs?: string[];
};

function requireString(name: string, val: unknown): string {
  if (typeof val !== "string" || val.trim().length === 0) {
    throw new Error(`${name}_REQUIRED`);
  }
  return val.trim();
}

export function eventRoomName(sharedEventID: string): string {
  return `event:${sharedEventID}`;
}

export async function createSharedEvent(
  io: SocketIOServer,
  input: CreateSharedEventInput,
) {
  requireString("localID", input.localID);
  requireString("title", input.title);
  requireString("hostUserID", input.hostUserID);
  requireString("hostDisplayName", input.hostDisplayName);
  if (!input.startDate) throw new Error("startDate_REQUIRED");

  const inviteToken = randomUUID();
  const shareCode = randomUUID().slice(0, 8).toUpperCase();

  const created = await SharedEvent.create({
    localID: input.localID,
    title: input.title,
    description: input.description ?? "",
    iconName: input.iconName ?? "",
    colorHex: input.colorHex ?? "#03dbfc",
    timezoneIdentifier: input.timezoneIdentifier ?? "UTC",
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
    isAllDay: !!input.isAllDay,
    locationName: input.locationName ?? "",
    address: input.address ?? "",
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    visibility: input.visibility ?? "private",
    inviteToken,
    shareCode,
    hostUserID: input.hostUserID,
    hostDisplayName: input.hostDisplayName,
    hostAvatarURL: input.hostAvatarURL ?? "",
    calendarIDs: input.calendarIDs ?? [],
  });

  // Bootstrap host + permissions + host attendee row atomically at the
  // service layer — one round trip per model since we don't want to force
  // Atlas to require transactions.
  await Host.create({
    localID: randomUUID(),
    sharedEventID: String(created._id),
    userID: input.hostUserID,
    displayName: input.hostDisplayName,
    avatarURL: input.hostAvatarURL ?? "",
    isPrimary: true,
    isFormer: false,
  });
  await Permissions.create({
    localID: randomUUID(),
    sharedEventID: String(created._id),
  });
  await Attendee.create({
    localID: randomUUID(),
    sharedEventID: String(created._id),
    userID: input.hostUserID,
    displayName: input.hostDisplayName,
    avatarURL: input.hostAvatarURL ?? "",
    role: "host",
    joinedAt: new Date(),
  });

  io.to(eventRoomName(String(created._id))).emit("event:created", created);
  return created.toObject();
}

export async function getSharedEvent(sharedEventID: string) {
  const event = await SharedEvent.findById(sharedEventID).lean();
  if (!event) throw new Error("EVENT_NOT_FOUND");
  return event;
}

export async function updateSharedEvent(
  io: SocketIOServer,
  sharedEventID: string,
  actorUserID: string,
  patch: Partial<CreateSharedEventInput>,
) {
  await assertActorIsHostOrCoHost(sharedEventID, actorUserID);

  const updateDoc: Record<string, unknown> = {};
  const allowed: (keyof CreateSharedEventInput)[] = [
    "title",
    "description",
    "iconName",
    "colorHex",
    "timezoneIdentifier",
    "startDate",
    "endDate",
    "isAllDay",
    "locationName",
    "address",
    "latitude",
    "longitude",
    "visibility",
    "calendarIDs",
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      updateDoc[key] =
        key === "startDate" || key === "endDate"
          ? patch[key]
            ? new Date(patch[key] as string | Date)
            : null
          : patch[key];
    }
  }

  const updated = await SharedEvent.findByIdAndUpdate(sharedEventID, updateDoc, {
    new: true,
  }).lean();
  if (!updated) throw new Error("EVENT_NOT_FOUND");

  io.to(eventRoomName(sharedEventID)).emit("event:updated", updated);
  return updated;
}

export async function cancelSharedEvent(
  io: SocketIOServer,
  sharedEventID: string,
  actorUserID: string,
  reason: string,
) {
  await assertActorIsHostOrCoHost(sharedEventID, actorUserID);
  const updated = await SharedEvent.findByIdAndUpdate(
    sharedEventID,
    { cancelledAt: new Date(), cancellationReason: reason || "" },
    { new: true },
  ).lean();
  if (!updated) throw new Error("EVENT_NOT_FOUND");
  io.to(eventRoomName(sharedEventID)).emit("event:cancelled", updated);
  return updated;
}

export async function listEventsForUser(userID: string) {
  const asHost = await SharedEvent.find({ hostUserID: userID })
    .sort({ startDate: -1 })
    .lean();
  const attendeeRows = await Attendee.find({ userID, removedAt: null }).lean();
  const eventIDs = attendeeRows.map((a: any) => a.sharedEventID);
  const asAttendee = await SharedEvent.find({ _id: { $in: eventIDs } })
    .sort({ startDate: -1 })
    .lean();
  return { asHost, asAttendee };
}

async function assertActorIsHostOrCoHost(
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
