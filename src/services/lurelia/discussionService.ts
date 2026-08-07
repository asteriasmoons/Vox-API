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
import { dispatchNotification } from "./notificationService";

const Comment = CommentRaw as Model<any>;
const CommentReply = CommentReplyRaw as Model<any>;
const CommentReaction = CommentReactionRaw as Model<any>;
const Attendee = AttendeeRaw as Model<any>;
const SharedEvent = SharedEventRaw as Model<any>;
const Permissions = PermissionsRaw as Model<any>;

const MENTION_REGEX = /@([A-Za-z0-9_]+)/g;

type MentionCandidate = {
  userID: string;
  displayName: string;
};

function mentionToken(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .toLowerCase();
}

async function resolveMentionedUserIDs(
  sharedEventID: string,
  body: string,
  extraCandidates: MentionCandidate[] = [],
): Promise<string[]> {
  const matches = body.match(MENTION_REGEX) || [];
  const tokens = new Set(matches.map((m) => m.slice(1).toLowerCase()));
  if (tokens.size === 0) return [];

  const attendees = await Attendee.find({
    sharedEventID,
    removedAt: null,
  }).lean<any[]>();

  const candidates = [
    ...attendees.map((attendee) => ({
      userID: String(attendee.userID),
      displayName: String(attendee.displayName || ""),
    })),
    ...extraCandidates,
  ];

  const mentioned = candidates
    .filter((attendee) => {
      const displayToken = mentionToken(attendee.displayName);
      const userToken = mentionToken(attendee.userID);
      return tokens.has(displayToken) || tokens.has(userToken);
    })
    .map((attendee) => String(attendee.userID));

  return Array.from(new Set(mentioned));
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
    mentionedUserIDs: await resolveMentionedUserIDs(input.sharedEventID, input.body, [
      { userID: input.authorUserID, displayName: input.authorDisplayName },
    ]),
  });

  await SharedEvent.findByIdAndUpdate(input.sharedEventID, {
    $inc: { "counts.comments": 1 },
  });

  io.to(eventRoomName(input.sharedEventID)).emit(
    "event:comment_added",
    created.toObject(),
  );

  await dispatchNotification({
    sharedEventID: input.sharedEventID,
    kind: "comment",
    payload: {
      commentID: String(created._id),
      actorName: input.authorDisplayName,
    },
  });

  return created.toObject();
}

function asObjectID(value: unknown): string {
  if (!value) return "";
  return String(value);
}

function attachLikedState<T extends Record<string, any>>(
  item: T,
  likedIDs: Set<string>,
): T & { isLiked: boolean } {
  return {
    ...item,
    isLiked: likedIDs.has(asObjectID(item._id)),
  };
}

function buildReplyTree(
  replies: any[],
  likedReplyIDs: Set<string>,
  parentReplyID = "",
): any[] {
  return replies
    .filter((reply) => String(reply.parentReplyID || "") === parentReplyID)
    .map((reply) => ({
      ...attachLikedState(reply, likedReplyIDs),
      replies: buildReplyTree(replies, likedReplyIDs, String(reply._id)),
    }));
}

async function collectReplyThreadIDs(
  parentCommentID: string,
  rootReplyID: string,
): Promise<string[]> {
  const replies = await CommentReply.find({
    parentCommentID,
    deletedAt: null,
  })
    .select("_id parentReplyID")
    .lean<any[]>();
  const childrenByParent = new Map<string, string[]>();

  for (const reply of replies) {
    const parentID = String(reply.parentReplyID || "");
    const childIDs = childrenByParent.get(parentID) || [];
    childIDs.push(String(reply._id));
    childrenByParent.set(parentID, childIDs);
  }

  const ids: string[] = [];
  const stack = [rootReplyID];
  while (stack.length > 0) {
    const currentID = stack.pop();
    if (!currentID || ids.includes(currentID)) continue;
    ids.push(currentID);
    stack.push(...(childrenByParent.get(currentID) || []));
  }

  return ids;
}

export async function listComments(
  sharedEventID: string,
  eventPostID?: string,
  viewerUserID?: string,
) {
  const filter: Record<string, unknown> = { sharedEventID, deletedAt: null };
  if (eventPostID !== undefined) filter.eventPostID = eventPostID;

  const comments = await Comment.find(filter)
    .sort({ isPinned: -1, createdAt: -1 })
    .lean();
  const commentIDs = comments.map((comment: any) => String(comment._id));
  const replies = commentIDs.length > 0
    ? await CommentReply.find({
        parentCommentID: { $in: commentIDs },
        deletedAt: null,
      })
        .sort({ createdAt: 1 })
        .lean()
    : [];

  let likedCommentIDs = new Set<string>();
  let likedReplyIDs = new Set<string>();
  if (viewerUserID) {
    const replyIDs = replies.map((reply: any) => String(reply._id));
    const reactions = await CommentReaction.find({
      userID: viewerUserID,
      kind: "like",
      $or: [
        { commentID: { $in: commentIDs } },
        { replyID: { $in: replyIDs } },
      ],
    }).lean<any[]>();

    likedCommentIDs = new Set(
      reactions
        .map((reaction) => String(reaction.commentID || ""))
        .filter(Boolean),
    );
    likedReplyIDs = new Set(
      reactions
        .map((reaction) => String(reaction.replyID || ""))
        .filter(Boolean),
    );
  }

  return comments.map((comment: any) => ({
    ...attachLikedState(comment, likedCommentIDs),
    replies: buildReplyTree(
      replies.filter((reply: any) => String(reply.parentCommentID) === String(comment._id)),
      likedReplyIDs,
    ),
  }));
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
  comment.mentionedUserIDs = await resolveMentionedUserIDs(comment.sharedEventID, body, [
    { userID: comment.authorUserID, displayName: comment.authorDisplayName },
  ]);
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
  if (!comment || comment.deletedAt) throw new Error("COMMENT_NOT_FOUND");
  const canModerate = await isModerator(comment.sharedEventID, actorUserID);
  if (comment.authorUserID !== actorUserID && !canModerate) {
    throw new Error("FORBIDDEN");
  }
  comment.deletedAt = new Date();
  await comment.save();
  await CommentReply.updateMany(
    { parentCommentID: String(comment._id), deletedAt: null },
    { $set: { deletedAt: comment.deletedAt } },
  );
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
  parentReplyID?: string;
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

  let parentReplyID = "";
  if (input.parentReplyID) {
    const parentReply = await CommentReply.findById(input.parentReplyID).lean<any>();
    if (!parentReply || parentReply.deletedAt) throw new Error("PARENT_REPLY_NOT_FOUND");
    if (
      String(parentReply.parentCommentID) !== String(parent._id)
      || parentReply.sharedEventID !== parent.sharedEventID
    ) {
      throw new Error("PARENT_REPLY_MISMATCH");
    }
    parentReplyID = String(parentReply._id);
  }

  const reply = await CommentReply.create({
    localID: randomUUID(),
    parentCommentID: input.parentCommentID,
    parentReplyID,
    sharedEventID: parent.sharedEventID,
    authorUserID: input.authorUserID,
    authorDisplayName: input.authorDisplayName,
    authorAvatarURL: input.authorAvatarURL ?? "",
    body: input.body.trim(),
    mentionedUserIDs: await resolveMentionedUserIDs(parent.sharedEventID, input.body, [
      { userID: input.authorUserID, displayName: input.authorDisplayName },
    ]),
  });
  parent.replyCount = (parent.replyCount || 0) + 1;
  await parent.save();

  io.to(eventRoomName(parent.sharedEventID)).emit(
    "event:reply_added",
    reply.toObject(),
  );

  await dispatchNotification({
    sharedEventID: parent.sharedEventID,
    kind: "reply",
    payload: {
      replyID: String(reply._id),
      parentCommentID: input.parentCommentID,
      actorName: input.authorDisplayName,
    },
  });

  return reply.toObject();
}

export async function listReplies(parentCommentID: string, viewerUserID?: string) {
  const replies = await CommentReply.find({ parentCommentID, deletedAt: null })
    .sort({ createdAt: 1 })
    .lean();

  let likedReplyIDs = new Set<string>();
  if (viewerUserID) {
    const replyIDs = replies.map((reply: any) => String(reply._id));
    const reactions = await CommentReaction.find({
      userID: viewerUserID,
      kind: "like",
      replyID: { $in: replyIDs },
    }).lean<any[]>();
    likedReplyIDs = new Set(reactions.map((reaction) => String(reaction.replyID)));
  }

  return buildReplyTree(replies, likedReplyIDs);
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
  reply.mentionedUserIDs = await resolveMentionedUserIDs(reply.sharedEventID, body, [
    { userID: reply.authorUserID, displayName: reply.authorDisplayName },
  ]);
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
  if (!reply || reply.deletedAt) throw new Error("REPLY_NOT_FOUND");
  const canModerate = await isModerator(reply.sharedEventID, actorUserID);
  if (reply.authorUserID !== actorUserID && !canModerate) {
    throw new Error("FORBIDDEN");
  }
  const deletedAt = new Date();
  const replyIDs = await collectReplyThreadIDs(reply.parentCommentID, String(reply._id));
  await CommentReply.updateMany(
    { _id: { $in: replyIDs } },
    { $set: { deletedAt } },
  );
  await Comment.findByIdAndUpdate(reply.parentCommentID, {
    $inc: { replyCount: -replyIDs.length },
  });
  io.to(eventRoomName(reply.sharedEventID)).emit("event:reply_deleted", {
    replyID: String(reply._id),
    replyIDs,
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
