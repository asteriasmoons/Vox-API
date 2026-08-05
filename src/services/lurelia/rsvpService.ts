// src/services/lurelia/rsvpService.ts

import type { Model } from "mongoose";
import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";

import { LureliaRSVP as RSVPRaw } from "../../models/lurelia/RSVP";
import { LureliaSharedEvent as SharedEventRaw } from "../../models/lurelia/SharedEvent";
import { LureliaPermissions as PermissionsRaw } from "../../models/lurelia/Permissions";

import { eventRoomName } from "./sharedEventService";

const RSVP = RSVPRaw as Model<any>;
const SharedEvent = SharedEventRaw as Model<any>;
const Permissions = PermissionsRaw as Model<any>;

export type SetRSVPInput = {
  sharedEventID: string;
  userID: string;
  displayName: string;
  avatarURL?: string;
  status: "going" | "interested" | "declined" | "pending";
  note?: string;
  plusOneCount?: number;
};

export async function setRSVP(io: SocketIOServer, input: SetRSVPInput) {
  const perms = await Permissions.findOne({
    sharedEventID: input.sharedEventID,
  }).lean<any>();
  if (perms && perms.allowRSVPChanges === false) {
    // Allow first-ever RSVP even if changes are disabled.
    const existing = await RSVP.findOne({
      sharedEventID: input.sharedEventID,
      userID: input.userID,
    }).lean<any>();
    if (existing) throw new Error("RSVP_CHANGES_DISABLED");
  }

  const priorRSVP = await RSVP.findOne({
    sharedEventID: input.sharedEventID,
    userID: input.userID,
  });
  const priorStatus = priorRSVP?.status as string | undefined;

  const upsert = await RSVP.findOneAndUpdate(
    { sharedEventID: input.sharedEventID, userID: input.userID },
    {
      $set: {
        displayName: input.displayName,
        avatarURL: input.avatarURL ?? "",
        status: input.status,
        note: input.note ?? "",
        plusOneCount: input.plusOneCount ?? 0,
      },
      $setOnInsert: {
        localID: randomUUID(),
        sharedEventID: input.sharedEventID,
        userID: input.userID,
      },
    },
    { new: true, upsert: true },
  );

  // Maintain aggregate counts on the SharedEvent doc.
  const inc: Record<string, number> = {};
  if (priorStatus !== input.status) {
    inc[`counts.${input.status}`] = 1;
    if (priorStatus) inc[`counts.${priorStatus}`] = -1;
    await SharedEvent.findByIdAndUpdate(input.sharedEventID, { $inc: inc });
  }

  io.to(eventRoomName(input.sharedEventID)).emit(
    "event:rsvp_changed",
    upsert.toObject(),
  );
  return upsert.toObject();
}

export async function getRSVPForUser(sharedEventID: string, userID: string) {
  return await RSVP.findOne({ sharedEventID, userID }).lean();
}

export async function listRSVPs(sharedEventID: string) {
  return await RSVP.find({ sharedEventID })
    .sort({ status: 1, updatedAt: -1 })
    .lean();
}
