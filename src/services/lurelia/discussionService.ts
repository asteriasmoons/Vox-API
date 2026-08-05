// src/services/lurelia/discussionService.ts
//
// Comments, threaded replies, and reactions on either target.

import type { Model } from "mongoose";
import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";

import { LureliaComment as CommentRaw } from "../../models/lurelia/Comment";
import { LureliaCommentReply as CommentReplyRaw } from "../../models/lurelia/CommentReply";
import { LureliaCommentReaction as CommentReactionRaw } from "../../models/lurelia/CommentReaction";
import { LureliaAttendee as AttendeeRaw } from "../../models/lurelia/Attendee";
import { LureliaSharedEvent as SharedEventRaw } from "../../models/lurelia/SharedEvent";
import { LureliaPermissions as PermissionsRaw } from "../../models/lurelia/Permissions";

import { eventRoomName } from "./sharedEventService";

const Comment = CommentRaw as Model<any>;
const CommentReply = CommentReplyRaw as Model<any>;
const CommentReaction = CommentReactionRaw as Model<any>;
const Attendee = AttendeeRaw as Model<any>;
const SharedEvent = SharedEventRaw as Model<any>;
const Permissions = PermissionsRaw as Model<any>;

const MENTION_REGEX = /@([A-Za-z0-9_]+)/g;

function extractMentions(body: string): string[] {
  const matches = body.match(MENTION_REGEX) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}

async function assertCanComment(sharedEventID: string, userID: string) {
  const attendee = await Attendee.findOne({
    sharedEventID,
    userID,
    removedAt: null,
  }).lean<any>();
  if (!attendee) throw new Error("NOT_A_MEMBER");
  const perms = await Permissions.findOne({ sharedEventID }).lean<any>();
  if (perms?.allowComments === false) throw new Error("COMMENTS_DISABLED");
  if (attendee.role === "declined" && perms?.allowDeclinedComments === false) {
    throw new Error("DECLINED_CANNOT_COMMENT");
  }
}

// ── Comments ─────────────────────────────────────────────────────────────

export type CreateCommentInput = {
  sharedEventID: string;
  eventPostID?: string;
  authorUserID: string;
  authorDisplayName: string;
  authorAvatarURL?: string;
  body: string;
};

export async function createComment(
  io: SocketIOServer,
  input: CreateCommentInput,
) {
  if (!input.body?.trim()) throw new Error("body_REQUIRED");
  await assertCanComment(input.sharedEventID, input.authorUserID);

  const created = await Comment.create({
    localID: randomUUID(),
    sharedEventID: input.sharedEventID,
    eventPostID: input.eventPostID ?? "",
    authorUserID: input.authorUserID,
    authorDisplayName: input.authorDisplayName,
    authorAvatarURL: input.authorAvatarURL ?? "",
    body: input.body.trim(),
    mentionedUserIDs: extractMentions(input.body),
  });

  await SharedEvent.findByIdAndUpdate(input.sharedEventID, {
    $inc: { "counts.comments": 1 },
  });

  io.to(eventRoomName(input.sharedEventID)).emit(
    "event:comment_added",
    created.toObject(),
  );
  return created.toObject();
}

export async function listComments(sharedEventID: string, eventPostID?: string) {
  const filter: Record<string, unknown> = { sharedEventID, deletedAt: null };
  if (eventPostID !== undefined) filter.eventPostID = eventPostID;
  return await Comment.find(filter)
    .sort({ isPinned: -1, createdAt: -1 })
    .lean();
}

export async function editComment(
  io: SocketIOServer,
  commentID: string,
  actorUserID: string,
  body: string,
) {
  const comment = await Comment.findById(commentID);
  if (!comment) throw new Error("COMMENT_NOT_FOUND");
  if (comment.authorUserID !== actorUserID) throw new Error("FORBIDDEN");
  if (!body?.trim()) throw new Error("body_REQUIRED");
  comment.body = body.trim();
  comment.mentionedUserIDs = extractMentions(body);
  comment.editedAt = new Date();
  await comment.save();
  io.to(eventRoomName(comment.sharedEventID)).emit(
    "event:comment_edited",
    comment.toObject(),
  );
  return comment.toObject();
}

export async function deleteComment(
  io: SocketIOServer,
  commentID: string,
  actorUserID: string,
) {
  const comment = await Comment.findById(commentID);
  if (!comment) throw new Error("COMMENT_NOT_FOUND");
  const canModerate = await isModerator(comment.sharedEventID, actorUserID);
  if (comment.authorUserID !== actorUserID && !canModerate) {
    throw new Error("FORBIDDEN");
  }
  comment.deletedAt = new Date();
  await comment.save();
  await SharedEvent.findByIdAndUpdate(comment.sharedEventID, {
    $inc: { "counts.comments": -1 },
  });
  io.to(eventRoomName(comment.sharedEventID)).emit("event:comment_deleted", {
    commentID: String(comment._id),
    sharedEventID: comment.sharedEventID,
  });
  return { ok: true };
}

export async function pinComment(
  io: SocketIOServer,
  commentID: string,
  actorUserID: string,
  isPinned: boolean,
) {
  const comment = await Comment.findById(commentID);
  if (!comment) throw new Error("COMMENT_NOT_FOUND");
  if (!(await isModerator(comment.sharedEventID, actorUserID))) {
    throw new Error("FORBIDDEN");
  }
  comment.isPinned = !!isPinned;
  await comment.save();
  io.to(eventRoomName(comment.sharedEventID)).emit(
    "event:comment_pinned",
    comment.toObject(),
  );
  return comment.toObject();
}

// ── Replies ──────────────────────────────────────────────────────────────

export type CreateReplyInput = {
  parentCommentID: string;
  authorUserID: string;
  authorDisplayName: string;
  authorAvatarURL?: string;
  body: string;
};

export async function createReply(io: SocketIOServer, input: CreateReplyInput) {
  if (!input.body?.trim()) throw new Error("body_REQUIRED");
  const parent = await Comment.findById(input.parentCommentID);
  if (!parent) throw new Error("PARENT_NOT_FOUND");
  await assertCanComment(parent.sharedEventID, input.authorUserID);

  const reply = await CommentReply.create({
    localID: randomUUID(),
    parentCommentID: input.parentCommentID,
    sharedEventID: parent.sharedEventID,
    authorUserID: input.authorUserID,
    authorDisplayName: input.authorDisplayName,
    authorAvatarURL: input.authorAvatarURL ?? "",
    body: input.body.trim(),
    mentionedUserIDs: extractMentions(input.body),
  });
  parent.replyCount = (parent.replyCount || 0) + 1;
  await parent.save();

  io.to(eventRoomName(parent.sharedEventID)).emit(
    "event:reply_added",
    reply.toObject(),
  );
  return reply.toObject();
}

export async function listReplies(parentCommentID: string) {
  return await CommentReply.find({ parentCommentID, deletedAt: null })
    .sort({ createdAt: 1 })
    .lean();
}

export async function editReply(
  io: SocketIOServer,
  replyID: string,
  actorUserID: string,
  body: string,
) {
  const reply = await CommentReply.findById(replyID);
  if (!reply) throw new Error("REPLY_NOT_FOUND");
  if (reply.authorUserID !== actorUserID) throw new Error("FORBIDDEN");
  if (!body?.trim()) throw new Error("body_REQUIRED");
  reply.body = body.trim();
  reply.mentionedUserIDs = extractMentions(body);
  reply.editedAt = new Date();
  await reply.save();
  io.to(eventRoomName(reply.sharedEventID)).emit(
    "event:reply_edited",
    reply.toObject(),
  );
  return reply.toObject();
}

export async function deleteReply(
  io: SocketIOServer,
  replyID: string,
  actorUserID: string,
) {
  const reply = await CommentReply.findById(replyID);
  if (!reply) throw new Error("REPLY_NOT_FOUND");
  const canModerate = await isModerator(reply.sharedEventID, actorUserID);
  if (reply.authorUserID !== actorUserID && !canModerate) {
    throw new Error("FORBIDDEN");
  }
  reply.deletedAt = new Date();
  await reply.save();
  await Comment.findByIdAndUpdate(reply.parentCommentID, {
    $inc: { replyCount: -1 },
  });
  io.to(eventRoomName(reply.sharedEventID)).emit("event:reply_deleted", {
    replyID: String(reply._id),
    parentCommentID: reply.parentCommentID,
  });
  return { ok: true };
}

// ── Reactions ────────────────────────────────────────────────────────────

export type ToggleReactionInput = {
  commentID?: string;
  replyID?: string;
  userID: string;
  userDisplayName: string;
  kind: "like" | "heart" | "celebrate" | "laugh" | "wow" | "sad";
};

export async function toggleReaction(
  io: SocketIOServer,
  input: ToggleReactionInput,
) {
  if (!input.commentID === !input.replyID) {
    throw new Error("TARGET_REQUIRED");
  }
  const filter: Record<string, unknown> = {
    userID: input.userID,
    kind: input.kind,
    commentID: input.commentID ?? "",
    replyID: input.replyID ?? "",
  };
  const existing = await CommentReaction.findOne(filter);

  let sharedEventID = "";
  if (input.commentID) {
    const c = await Comment.findById(input.commentID).lean<any>();
    if (!c) throw new Error("COMMENT_NOT_FOUND");
    sharedEventID = c.sharedEventID;
  } else if (input.replyID) {
    const r = await CommentReply.findById(input.replyID).lean<any>();
    if (!r) throw new Error("REPLY_NOT_FOUND");
    sharedEventID = r.sharedEventID;
  }

  if (existing) {
    await CommentReaction.deleteOne({ _id: existing._id });
    if (input.commentID) {
      await Comment.findByIdAndUpdate(input.commentID, {
        $inc: { likesCount: -1 },
      });
    } else if (input.replyID) {
      await CommentReply.findByIdAndUpdate(input.replyID, {
        $inc: { likesCount: -1 },
      });
    }
    io.to(eventRoomName(sharedEventID)).emit("event:reaction_removed", {
      target: input.commentID ? "comment" : "reply",
      targetID: input.commentID ?? input.replyID,
      userID: input.userID,
      kind: input.kind,
    });
    return { added: false, kind: input.kind };
  }

  const created = await CommentReaction.create({
    localID: randomUUID(),
    commentID: input.commentID ?? "",
    replyID: input.replyID ?? "",
    userID: input.userID,
    userDisplayName: input.userDisplayName,
    kind: input.kind,
  });

  if (input.commentID) {
    await Comment.findByIdAndUpdate(input.commentID, {
      $inc: { likesCount: 1 },
    });
  } else if (input.replyID) {
    await CommentReply.findByIdAndUpdate(input.replyID, {
      $inc: { likesCount: 1 },
    });
  }

  io.to(eventRoomName(sharedEventID)).emit(
    "event:reaction_added",
    created.toObject(),
  );
  return { added: true, kind: input.kind };
}

async function isModerator(sharedEventID: string, userID: string) {
  const attendee = await Attendee.findOne({
    sharedEventID,
    userID,
    role: { $in: ["host", "coHost"] },
    removedAt: null,
  }).lean<any>();
  return !!attendee;
}
