// src/services/lurelia/syncService.ts
//
// Pull/push endpoints for the client-side offline queue (SyncState). Pull
// returns everything the client should mirror given a `since` cursor.
// Push accepts a batch of mutations and applies them in-order.

import type { Model } from "mongoose";

import { LureliaSharedEvent as SharedEventRaw } from "../../models/lurelia/SharedEvent";
import { LureliaAttendee as AttendeeRaw } from "../../models/lurelia/Attendee";
import { LureliaRSVP as RSVPRaw } from "../../models/lurelia/RSVP";
import { LureliaComment as CommentRaw } from "../../models/lurelia/Comment";
import { LureliaCommentReply as CommentReplyRaw } from "../../models/lurelia/CommentReply";
import { LureliaCommentReaction as CommentReactionRaw } from "../../models/lurelia/CommentReaction";
import { LureliaEventPost as EventPostRaw } from "../../models/lurelia/EventPost";
import { LureliaAnnouncement as AnnouncementRaw } from "../../models/lurelia/Announcement";
import { LureliaAttachment as AttachmentRaw } from "../../models/lurelia/Attachment";
import { LureliaEventArtwork as EventArtworkRaw } from "../../models/lurelia/EventArtwork";
import { LureliaInvitation as InvitationRaw } from "../../models/lurelia/Invitation";
import { LureliaPermissions as PermissionsRaw } from "../../models/lurelia/Permissions";
import { LureliaHost as HostRaw } from "../../models/lurelia/Host";

const SharedEvent = SharedEventRaw as Model<any>;
const Attendee = AttendeeRaw as Model<any>;
const RSVP = RSVPRaw as Model<any>;
const Comment = CommentRaw as Model<any>;
const CommentReply = CommentReplyRaw as Model<any>;
const CommentReaction = CommentReactionRaw as Model<any>;
const EventPost = EventPostRaw as Model<any>;
const Announcement = AnnouncementRaw as Model<any>;
const Attachment = AttachmentRaw as Model<any>;
const EventArtwork = EventArtworkRaw as Model<any>;
const Invitation = InvitationRaw as Model<any>;
const Permissions = PermissionsRaw as Model<any>;
const Host = HostRaw as Model<any>;

type PullInput = {
  sharedEventID: string;
  since?: string | null;
};

export async function pullChanges({ sharedEventID, since }: PullInput) {
  const sinceDate = since ? new Date(since) : new Date(0);
  const filter = { sharedEventID, updatedAt: { $gt: sinceDate } };
  const rootFilter = {
    _id: sharedEventID,
    updatedAt: { $gt: sinceDate },
  };

  const [
    event,
    permissions,
    hosts,
    attendees,
    rsvps,
    invitations,
    posts,
    announcements,
    comments,
    replies,
    reactions,
    attachments,
    artwork,
  ] = await Promise.all([
    SharedEvent.findOne(rootFilter).lean(),
    Permissions.find(filter).lean(),
    Host.find(filter).lean(),
    Attendee.find(filter).lean(),
    RSVP.find(filter).lean(),
    Invitation.find(filter).lean(),
    EventPost.find(filter).lean(),
    Announcement.find(filter).lean(),
    Comment.find(filter).lean(),
    CommentReply.find(filter).lean(),
    // Reactions are keyed by commentID / replyID rather than sharedEventID —
    // do a two-step lookup instead of the shared filter.
    (async () => {
      const commentIDs = (await Comment.find({ sharedEventID }).select("_id").lean())
        .map((c: any) => String(c._id));
      const replyIDs = (await CommentReply.find({ sharedEventID }).select("_id").lean())
        .map((r: any) => String(r._id));
      return await CommentReaction.find({
        $or: [
          { commentID: { $in: commentIDs } },
          { replyID: { $in: replyIDs } },
        ],
        updatedAt: { $gt: sinceDate },
      }).lean();
    })(),
    Attachment.find(filter).lean(),
    EventArtwork.find(filter).lean(),
  ]);

  return {
    cursor: new Date().toISOString(),
    event,
    permissions,
    hosts,
    attendees,
    rsvps,
    invitations,
    posts,
    announcements,
    comments,
    replies,
    reactions,
    attachments,
    artwork,
  };
}

/**
 * A client-side offline mutation. The client sends these when reconnecting;
 * routes fan them out to the correct service functions.
 */
export type MutationEnvelope = {
  entityType: string;
  operation: "create" | "update" | "delete";
  entityLocalID: string;
  entityRemoteID?: string;
  payload: Record<string, unknown>;
};

/**
 * Router that dispatches a single mutation. The heavy lifting lives in the
 * matching service — this is the switchboard. New entity types get added
 * here as they land.
 */
export function describeMutationHandler(env: MutationEnvelope) {
  return {
    entityType: env.entityType,
    operation: env.operation,
    handler: `${env.entityType}.${env.operation}`,
  };
}
