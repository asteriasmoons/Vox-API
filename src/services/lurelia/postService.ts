// src/services/lurelia/postService.ts
//
// EventPost + Announcement. Host-authored timeline entries with Markdown
// bodies (Tiptap-exported) and optional Attachments. Announcements fan
// out via the notification service on create.

import type { Model } from "mongoose";
import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";

import { LureliaEventPost as EventPostRaw } from "../../models/lurelia/EventPost";
import { LureliaAnnouncement as AnnouncementRaw } from "../../models/lurelia/Announcement";
import { LureliaAttendee as AttendeeRaw } from "../../models/lurelia/Attendee";
import { LureliaSharedEvent as SharedEventRaw } from "../../models/lurelia/SharedEvent";
import { LureliaPermissions as PermissionsRaw } from "../../models/lurelia/Permissions";

import { eventRoomName } from "./sharedEventService";
import { dispatchNotification } from "./notificationService";
import { normalizeHostPostBody } from "./postSanitizer";

const EventPost = EventPostRaw as Model<any>;
const Announcement = AnnouncementRaw as Model<any>;
const Attendee = AttendeeRaw as Model<any>;
const SharedEvent = SharedEventRaw as Model<any>;
const Permissions = PermissionsRaw as Model<any>;

async function assertHostOrGuestAllowed(
  sharedEventID: string,
  userID: string,
): Promise<{ role: string }> {
  const attendee = await Attendee.findOne({
    sharedEventID,
    userID,
    removedAt: null,
  }).lean<any>();
  if (!attendee) throw new Error("NOT_A_MEMBER");
  const isMod = attendee.role === "host" || attendee.role === "coHost";
  if (isMod) return { role: attendee.role };

  const perms = await Permissions.findOne({ sharedEventID }).lean<any>();
  if (perms?.allowGuestPosts !== true) throw new Error("GUEST_POSTS_DISABLED");
  return { role: attendee.role };
}

// ── EventPost ────────────────────────────────────────────────────────────

export type CreatePostInput = {
  sharedEventID: string;
  authorUserID: string;
  authorDisplayName: string;
  authorAvatarURL?: string;
  title?: string;
  bodyMarkdown: string;
  bodyHTML?: string;
  isPinned?: boolean;
};

export async function createPost(io: SocketIOServer, input: CreatePostInput) {
  if (!input.bodyMarkdown?.trim()) throw new Error("body_REQUIRED");
  const { role } = await assertHostOrGuestAllowed(
    input.sharedEventID,
    input.authorUserID,
  );
  const canPin = role === "host" || role === "coHost";

  const normalized = normalizeHostPostBody({
    bodyMarkdown: input.bodyMarkdown,
    bodyHTML: input.bodyHTML,
  });
  const title = normalizePostTitle(input.title, normalized.bodyMarkdown);

  const created = await EventPost.create({
    localID: randomUUID(),
    sharedEventID: input.sharedEventID,
    authorUserID: input.authorUserID,
    authorDisplayName: input.authorDisplayName,
    authorAvatarURL: input.authorAvatarURL ?? "",
    title,
    bodyMarkdown: normalized.bodyMarkdown,
    bodyHTML: normalized.bodyHTML,
    isPinned: canPin && !!input.isPinned,
    notificationSentAt: new Date(),
  });

  await SharedEvent.findByIdAndUpdate(input.sharedEventID, {
    $inc: { "counts.posts": 1 },
  });

  io.to(eventRoomName(input.sharedEventID)).emit(
    "event:post_published",
    created.toObject(),
  );

  await dispatchNotification({
    sharedEventID: input.sharedEventID,
    kind: "hostPost",
    payload: { postID: String(created._id), title },
  });

  return created.toObject();
}

export async function listPosts(sharedEventID: string) {
  return await EventPost.find({ sharedEventID, deletedAt: null })
    .sort({ isPinned: -1, createdAt: -1 })
    .lean();
}

export async function editPost(
  io: SocketIOServer,
  postID: string,
  actorUserID: string,
  patch: {
    title?: string;
    bodyMarkdown?: string;
    bodyHTML?: string;
    isPinned?: boolean;
  },
) {
  const post = await EventPost.findById(postID);
  if (!post) throw new Error("POST_NOT_FOUND");
  const canModerate = await isModerator(post.sharedEventID, actorUserID);
  if (post.authorUserID !== actorUserID && !canModerate) {
    throw new Error("FORBIDDEN");
  }
  if (patch.bodyMarkdown !== undefined || patch.bodyHTML !== undefined) {
    const normalized = normalizeHostPostBody({
      bodyMarkdown: patch.bodyMarkdown ?? post.bodyMarkdown,
      bodyHTML: patch.bodyHTML ?? post.bodyHTML,
    });
    if (!normalized.bodyMarkdown.trim()) throw new Error("body_REQUIRED");
    post.bodyMarkdown = normalized.bodyMarkdown;
    post.bodyHTML = normalized.bodyHTML;
  }
  if (patch.title !== undefined) {
    post.title = normalizePostTitle(patch.title, post.bodyMarkdown);
  }
  if (patch.isPinned !== undefined && canModerate) post.isPinned = !!patch.isPinned;
  post.editedAt = new Date();
  await post.save();

  io.to(eventRoomName(post.sharedEventID)).emit(
    "event:post_edited",
    post.toObject(),
  );

  await dispatchNotification({
    sharedEventID: post.sharedEventID,
    kind: "edit",
    payload: { postID: String(post._id) },
  });

  return post.toObject();
}

export async function deletePost(
  io: SocketIOServer,
  postID: string,
  actorUserID: string,
) {
  const post = await EventPost.findById(postID);
  if (!post) throw new Error("POST_NOT_FOUND");
  const canModerate = await isModerator(post.sharedEventID, actorUserID);
  if (post.authorUserID !== actorUserID && !canModerate) {
    throw new Error("FORBIDDEN");
  }
  post.deletedAt = new Date();
  await post.save();
  await SharedEvent.findByIdAndUpdate(post.sharedEventID, {
    $inc: { "counts.posts": -1 },
  });
  io.to(eventRoomName(post.sharedEventID)).emit("event:post_deleted", {
    postID: String(post._id),
    sharedEventID: post.sharedEventID,
  });
  return { ok: true };
}

// ── Announcement ─────────────────────────────────────────────────────────

export type CreateAnnouncementInput = {
  sharedEventID: string;
  authorUserID: string;
  authorDisplayName: string;
  authorAvatarURL?: string;
  title?: string;
  bodyMarkdown: string;
  bodyHTML?: string;
};

export async function createAnnouncement(
  io: SocketIOServer,
  input: CreateAnnouncementInput,
) {
  if (!input.bodyMarkdown?.trim()) throw new Error("body_REQUIRED");
  const canModerate = await isModerator(input.sharedEventID, input.authorUserID);
  if (!canModerate) throw new Error("FORBIDDEN");

  const normalizedAnn = normalizeHostPostBody({
    bodyMarkdown: input.bodyMarkdown,
    bodyHTML: input.bodyHTML,
  });
  const title = normalizePostTitle(input.title, normalizedAnn.bodyMarkdown);

  const created = await Announcement.create({
    localID: randomUUID(),
    sharedEventID: input.sharedEventID,
    authorUserID: input.authorUserID,
    authorDisplayName: input.authorDisplayName,
    authorAvatarURL: input.authorAvatarURL ?? "",
    title,
    bodyMarkdown: normalizedAnn.bodyMarkdown,
    bodyHTML: normalizedAnn.bodyHTML,
    notificationSentAt: new Date(),
  });

  io.to(eventRoomName(input.sharedEventID)).emit(
    "event:announcement_created",
    created.toObject(),
  );

  await dispatchNotification({
    sharedEventID: input.sharedEventID,
    kind: "announcement",
    payload: { announcementID: String(created._id), title },
  });

  return created.toObject();
}

export async function listAnnouncements(sharedEventID: string) {
  return await Announcement.find({ sharedEventID, deletedAt: null })
    .sort({ createdAt: -1 })
    .lean();
}

export async function editAnnouncement(
  io: SocketIOServer,
  announcementID: string,
  actorUserID: string,
  patch: { title?: string; bodyMarkdown?: string; bodyHTML?: string },
) {
  const announcement = await Announcement.findById(announcementID);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");
  if (!(await isModerator(announcement.sharedEventID, actorUserID))) {
    throw new Error("FORBIDDEN");
  }
  if (patch.bodyMarkdown !== undefined || patch.bodyHTML !== undefined) {
    const normalizedAnn = normalizeHostPostBody({
      bodyMarkdown: patch.bodyMarkdown ?? announcement.bodyMarkdown,
      bodyHTML: patch.bodyHTML ?? announcement.bodyHTML,
    });
    if (!normalizedAnn.bodyMarkdown.trim()) throw new Error("body_REQUIRED");
    announcement.bodyMarkdown = normalizedAnn.bodyMarkdown;
    announcement.bodyHTML = normalizedAnn.bodyHTML;
  }
  if (patch.title !== undefined) {
    announcement.title = normalizePostTitle(patch.title, announcement.bodyMarkdown);
  }
  announcement.editedAt = new Date();
  await announcement.save();
  io.to(eventRoomName(announcement.sharedEventID)).emit(
    "event:announcement_edited",
    announcement.toObject(),
  );
  return announcement.toObject();
}

export async function deleteAnnouncement(
  io: SocketIOServer,
  announcementID: string,
  actorUserID: string,
) {
  const announcement = await Announcement.findById(announcementID);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");
  if (!(await isModerator(announcement.sharedEventID, actorUserID))) {
    throw new Error("FORBIDDEN");
  }
  announcement.deletedAt = new Date();
  await announcement.save();
  io.to(eventRoomName(announcement.sharedEventID)).emit(
    "event:announcement_deleted",
    {
      announcementID: String(announcement._id),
      sharedEventID: announcement.sharedEventID,
    },
  );
  return { ok: true };
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

function normalizePostTitle(inputTitle: unknown, bodyMarkdown: string): string {
  const explicit = String(inputTitle ?? "").trim();
  if (explicit) return stripInlineMarkdown(explicit).slice(0, 180);

  const lines = String(bodyMarkdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(":::"));

  const heading = lines.find((line) => /^#{1,3}\s+/.test(line));
  const fallback = heading?.replace(/^#{1,3}\s+/, "") ?? lines[0] ?? "Untitled post";
  return stripInlineMarkdown(fallback).slice(0, 180) || "Untitled post";
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
