// src/services/lurelia/invitationService.ts

import type { Model } from "mongoose";
import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";

import { LureliaInvitation as InvitationRaw } from "../../models/lurelia/Invitation";
import { LureliaAttendee as AttendeeRaw } from "../../models/lurelia/Attendee";
import { LureliaSharedEvent as SharedEventRaw } from "../../models/lurelia/SharedEvent";

import { eventRoomName } from "./sharedEventService";
import { joinEvent } from "./attendeeService";

const Invitation = InvitationRaw as Model<any>;
const Attendee = AttendeeRaw as Model<any>;
const SharedEvent = SharedEventRaw as Model<any>;

export type CreateInvitationInput = {
  sharedEventID: string;
  senderUserID: string;
  senderDisplayName: string;
  recipientUserID?: string;
  recipientDisplayName?: string;
  recipientEmail?: string;
  message?: string;
  channel?: "inApp" | "email" | "link" | "shareSheet" | "qrCode";
  expiresInDays?: number;
};

export async function createInvitation(
  io: SocketIOServer,
  input: CreateInvitationInput,
) {
  if (!input.sharedEventID) throw new Error("sharedEventID_REQUIRED");
  if (!input.senderUserID) throw new Error("senderUserID_REQUIRED");
  if (!input.recipientUserID && !input.recipientEmail) {
    throw new Error("recipient_REQUIRED");
  }

  const inviteToken = randomUUID();
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const created = await Invitation.create({
    localID: randomUUID(),
    sharedEventID: input.sharedEventID,
    inviteToken,
    senderUserID: input.senderUserID,
    senderDisplayName: input.senderDisplayName,
    recipientUserID: input.recipientUserID ?? "",
    recipientDisplayName: input.recipientDisplayName ?? "",
    recipientEmail: input.recipientEmail ?? "",
    channel: input.channel ?? "inApp",
    message: input.message ?? "",
    sentAt: new Date(),
    expiresAt,
  });

  // If the recipient is a known user, also create a placeholder Attendee row
  // marked "invited" so their event surfaces in "Invited to" lists.
  if (input.recipientUserID) {
    const existing = await Attendee.findOne({
      sharedEventID: input.sharedEventID,
      userID: input.recipientUserID,
    });
    if (!existing) {
      await Attendee.create({
        localID: randomUUID(),
        sharedEventID: input.sharedEventID,
        userID: input.recipientUserID,
        displayName: input.recipientDisplayName ?? "",
        role: "invited",
      });
    }
  }

  io.to(eventRoomName(input.sharedEventID)).emit(
    "event:invitation_sent",
    created.toObject(),
  );

  return created.toObject();
}

export async function listInvitationsForEvent(sharedEventID: string) {
  return await Invitation.find({ sharedEventID })
    .sort({ sentAt: -1 })
    .lean();
}

export async function listInvitationsForUser(userID: string) {
  return await Invitation.find({
    recipientUserID: userID,
    status: "pending",
  })
    .sort({ sentAt: -1 })
    .lean();
}

export async function acceptInvitation(
  io: SocketIOServer,
  inviteToken: string,
  userID: string,
  displayName: string,
  avatarURL: string = "",
) {
  const invitation = await Invitation.findOne({ inviteToken });
  if (!invitation) throw new Error("INVITATION_NOT_FOUND");
  if (invitation.status !== "pending") throw new Error("INVITATION_NOT_PENDING");
  if (invitation.expiresAt && new Date() > invitation.expiresAt) {
    invitation.status = "expired";
    await invitation.save();
    throw new Error("INVITATION_EXPIRED");
  }
  if (invitation.recipientUserID && invitation.recipientUserID !== userID) {
    throw new Error("INVITATION_MISMATCH");
  }

  invitation.status = "accepted";
  invitation.respondedAt = new Date();
  if (!invitation.recipientUserID) invitation.recipientUserID = userID;
  await invitation.save();

  const attendee = await joinEvent(
    io,
    invitation.sharedEventID,
    userID,
    displayName,
    avatarURL,
  );

  io.to(eventRoomName(invitation.sharedEventID)).emit(
    "event:invitation_accepted",
    { invitation: invitation.toObject(), attendee },
  );

  return { invitation: invitation.toObject(), attendee };
}

export async function declineInvitation(
  io: SocketIOServer,
  inviteToken: string,
  userID: string,
) {
  const invitation = await Invitation.findOne({ inviteToken });
  if (!invitation) throw new Error("INVITATION_NOT_FOUND");
  if (invitation.status !== "pending") throw new Error("INVITATION_NOT_PENDING");
  if (invitation.recipientUserID && invitation.recipientUserID !== userID) {
    throw new Error("INVITATION_MISMATCH");
  }
  invitation.status = "declined";
  invitation.respondedAt = new Date();
  await invitation.save();
  io.to(eventRoomName(invitation.sharedEventID)).emit(
    "event:invitation_declined",
    invitation.toObject(),
  );
  return invitation.toObject();
}

export async function revokeInvitation(
  io: SocketIOServer,
  inviteToken: string,
  actorUserID: string,
) {
  const invitation = await Invitation.findOne({ inviteToken });
  if (!invitation) throw new Error("INVITATION_NOT_FOUND");
  const attendee = await Attendee.findOne({
    sharedEventID: invitation.sharedEventID,
    userID: actorUserID,
    role: { $in: ["host", "coHost"] },
    removedAt: null,
  }).lean();
  if (!attendee) throw new Error("FORBIDDEN");
  invitation.status = "revoked";
  invitation.respondedAt = new Date();
  await invitation.save();
  io.to(eventRoomName(invitation.sharedEventID)).emit(
    "event:invitation_revoked",
    invitation.toObject(),
  );
  return invitation.toObject();
}
