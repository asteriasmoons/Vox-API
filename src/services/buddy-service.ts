// src/services/buddy-service.ts

import { BuddyAnnouncement, IBuddyAnnouncement } from "../models/BuddyAnnouncement";
import { BuddyGroup, IBuddyGroup } from "../models/BuddyGroup";
import { BuddyMessage, IBuddyMessage } from "../models/BuddyMessage";
import { Server as SocketIOServer } from "socket.io";

// 30 days TTL for announcements
const ANNOUNCEMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type PostAnnouncementInput = {
  ownerUserId: string;
  ownerDisplayName: string;
  bookTitle: string;
  bookAuthor?: string | null;
  bookCoverUrl?: string | null;
  bookKey?: string | null;
  message?: string | null;
  currentChapter?: number | null;
  currentPage?: number | null;
  maxMembers?: number;
};

type RequestToJoinInput = {
  announcementId: string;
  requesterUserId: string;
  requesterDisplayName: string;
};

type RespondToJoinRequestInput = {
  groupId: string;
  actorUserId: string;
  targetUserId: string;
  accept: boolean;
};

type LeaveGroupInput = {
  groupId: string;
  userId: string;
};

type SendMessageInput = {
  groupId: string;
  senderUserId: string;
  senderDisplayName: string;
  type?: "text" | "progress_update" | "system";
  text: string;
  progressChapter?: number | null;
  progressPage?: number | null;
};

type GetMessagesInput = {
  groupId: string;
  userId: string;
  before?: string | null;
  limit?: number;
};

type UpdateAnnouncementInput = {
  announcementId: string;
  ownerUserId: string;
  message?: string | null;
  currentChapter?: number | null;
  currentPage?: number | null;
  maxMembers?: number;
};

type OwnerAnnouncementInput = {
  announcementId: string;
  ownerUserId: string;
};

type BuddyAnnouncementDTO = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertMember(group: IBuddyGroup, userId: string) {
  const member = group.members.find((m) => m.userId === userId);
  if (!member || member.status === "left") throw new Error("NOT_A_MEMBER");
  return member;
}

function activeJoinedCount(group: IBuddyGroup): number {
  return group.members.filter((m) => m.status === "joined").length;
}

function activePendingCount(group: IBuddyGroup): number {
  return group.members.filter((m) => m.status === "pending").length;
}

function isAnnouncementOpen(announcement: IBuddyAnnouncement, now = new Date()): boolean {
  return (
    (announcement.status ?? "open") === "open" &&
    !announcement.deletedAt &&
    !announcement.archivedAt &&
    !announcement.closedAt &&
    announcement.expiresAt >= now
  );
}

function serializeAnnouncement(
  announcement: IBuddyAnnouncement,
  group?: IBuddyGroup,
): BuddyAnnouncementDTO {
  const activeMemberCount = group ? activeJoinedCount(group) : 1;
  const pendingMemberCount = group ? activePendingCount(group) : 0;
  const maxMembers = group?.maxMembers ?? announcement.maxMembers;

  return {
    ...announcement.toObject(),
    status: announcement.status ?? "open",
    activeMemberCount,
    pendingMemberCount,
    spotsLeft: Math.max(maxMembers - activeMemberCount, 0),
  };
}

async function loadGroupsForAnnouncements(
  announcements: IBuddyAnnouncement[],
): Promise<Map<string, IBuddyGroup>> {
  const announcementIds = announcements.map((announcement) => String(announcement._id));
  if (announcementIds.length === 0) return new Map();

  const groups = await BuddyGroup.find({ announcementId: { $in: announcementIds } });
  return new Map(groups.map((group) => [group.announcementId, group]));
}

async function assertOwnedAnnouncement(
  input: OwnerAnnouncementInput,
): Promise<IBuddyAnnouncement> {
  const announcement = await BuddyAnnouncement.findById(input.announcementId);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");
  if (announcement.ownerUserId !== input.ownerUserId) throw new Error("FORBIDDEN");
  return announcement;
}

// ---------------------------------------------------------------------------
// Announcement board
// ---------------------------------------------------------------------------

export async function postAnnouncement(
  input: PostAnnouncementInput,
): Promise<IBuddyAnnouncement> {
  const now = new Date();
  const activeCount = await BuddyAnnouncement.countDocuments({
    ownerUserId: input.ownerUserId,
    expiresAt: { $gte: now },
    status: { $nin: ["closed", "archived", "deleted"] },
    closedAt: null,
    archivedAt: null,
    deletedAt: null,
  });

  if (activeCount >= 3) {
    throw new Error("ANNOUNCEMENT_LIMIT_REACHED");
  }

  const expiresAt = new Date(Date.now() + ANNOUNCEMENT_TTL_MS);

  const announcement = await BuddyAnnouncement.create({
    ownerUserId: input.ownerUserId,
    ownerDisplayName: input.ownerDisplayName,
    bookTitle: input.bookTitle,
    bookAuthor: input.bookAuthor ?? null,
    bookCoverUrl: input.bookCoverUrl ?? null,
    bookKey: input.bookKey ?? null,
    message: input.message ?? null,
    currentChapter: input.currentChapter ?? null,
    currentPage: input.currentPage ?? null,
    maxMembers: input.maxMembers ?? 2,
    isActive: true,
    status: "open",
    expiresAt,
  });

  return announcement;
}

export async function getBoard(
  currentUserId?: string,
): Promise<BuddyAnnouncementDTO[]> {
  const now = new Date();

  BuddyAnnouncement.updateMany(
    { isActive: true, expiresAt: { $lt: now } },
    { isActive: false },
  ).catch(() => {});

  const announcements = await BuddyAnnouncement.find({
    expiresAt: { $gte: now },
    status: { $nin: ["closed", "archived", "deleted"] },
    closedAt: null,
    archivedAt: null,
    deletedAt: null,
  }).sort({ createdAt: -1 });

  const groupsByAnnouncement = await loadGroupsForAnnouncements(announcements);

  return announcements
    .filter((announcement) => {
      const group = groupsByAnnouncement.get(String(announcement._id));
      if (!group) return true;

      // Always surface groups the caller is already part of, even when full —
      // this is where they manage/leave the read.
      const isMyGroup =
        !!currentUserId &&
        group.members.some(
          (member) => member.userId === currentUserId && member.status === "joined",
        );
      if (isMyGroup) return true;

      return activeJoinedCount(group) < (group.maxMembers ?? announcement.maxMembers);
    })
    .map((announcement) =>
      serializeAnnouncement(
        announcement,
        groupsByAnnouncement.get(String(announcement._id)),
      ),
    );
}

export async function getMyAnnouncements(
  ownerUserId: string,
): Promise<BuddyAnnouncementDTO[]> {
  const now = new Date();
  const announcements = await BuddyAnnouncement.find({
    ownerUserId,
    expiresAt: { $gte: now },
    status: { $ne: "deleted" },
    deletedAt: null,
  }).sort({ createdAt: -1 });
  const groupsByAnnouncement = await loadGroupsForAnnouncements(announcements);

  return announcements.map((announcement) =>
    serializeAnnouncement(
      announcement,
      groupsByAnnouncement.get(String(announcement._id)),
    ),
  );
}

export async function removeAnnouncement(
  announcementId: string,
  ownerUserId: string,
): Promise<void> {
  const announcement = await assertOwnedAnnouncement({ announcementId, ownerUserId });
  announcement.isActive = false;
  announcement.status = "deleted";
  announcement.deletedAt = new Date();
  await announcement.save();
}

export async function archiveAnnouncement(
  input: OwnerAnnouncementInput,
): Promise<IBuddyAnnouncement> {
  const announcement = await assertOwnedAnnouncement(input);
  announcement.isActive = false;
  announcement.status = "archived";
  announcement.archivedAt = new Date();
  await announcement.save();
  return announcement;
}

export async function closeAnnouncement(
  input: OwnerAnnouncementInput,
): Promise<IBuddyAnnouncement> {
  const announcement = await assertOwnedAnnouncement(input);
  announcement.isActive = false;
  announcement.status = "closed";
  announcement.closedAt = new Date();
  await announcement.save();
  return announcement;
}

/**
 * Admin-only escape hatch. Reopens a closed or archived announcement — used
 * when an announcement was auto-closed because its author left the group.
 * Deleted announcements stay deleted.
 */
export async function reopenAnnouncement(
  announcementId: string,
): Promise<IBuddyAnnouncement> {
  const announcement = await BuddyAnnouncement.findById(announcementId);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");
  if (announcement.status === "deleted" || announcement.deletedAt) {
    throw new Error("ANNOUNCEMENT_NOT_FOUND");
  }

  announcement.status = "open";
  announcement.closedAt = null;
  announcement.archivedAt = null;
  announcement.isActive = true;
  announcement.expiresAt = new Date(Date.now() + ANNOUNCEMENT_TTL_MS);
  await announcement.save();
  return announcement;
}

export async function updateAnnouncement(
  input: UpdateAnnouncementInput,
): Promise<IBuddyAnnouncement> {
  const announcement = await BuddyAnnouncement.findById(input.announcementId);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");
  if (announcement.ownerUserId !== input.ownerUserId) throw new Error("FORBIDDEN");

  if (typeof input.message !== "undefined") announcement.message = input.message;
  if (typeof input.currentChapter !== "undefined")
    announcement.currentChapter = input.currentChapter;
  if (typeof input.currentPage !== "undefined")
    announcement.currentPage = input.currentPage;
  if (typeof input.maxMembers !== "undefined")
    announcement.maxMembers = input.maxMembers;

  await announcement.save();
  return announcement;
}

// ---------------------------------------------------------------------------
// Group & join flow
// ---------------------------------------------------------------------------

export async function requestToJoin(
  input: RequestToJoinInput,
  io: SocketIOServer,
): Promise<IBuddyGroup> {
  const announcement = await BuddyAnnouncement.findById(input.announcementId);
  if (!announcement || !isAnnouncementOpen(announcement))
    throw new Error("ANNOUNCEMENT_NOT_FOUND");

  let group = await BuddyGroup.findOne({ announcementId: input.announcementId });

  if (!group) {
    group = await BuddyGroup.create({
      announcementId: String(announcement._id),
      bookTitle: announcement.bookTitle,
      bookAuthor: announcement.bookAuthor,
      bookCoverUrl: announcement.bookCoverUrl,
      bookKey: announcement.bookKey,
      maxMembers: announcement.maxMembers,
      members: [
        {
          userId: announcement.ownerUserId,
          displayName: announcement.ownerDisplayName,
          status: "joined",
          joinedAt: announcement.createdAt,
          requestedAt: announcement.createdAt,
        },
      ],
      isActive: true,
    });

    announcement.groupId = String(group._id);
    await announcement.save();
  }

  const existing = group.members.find((m) => m.userId === input.requesterUserId);
  let joinedMember: typeof existing | null = null;
  if (existing) {
    if (existing.status === "joined") return group;
    if (existing.status === "pending") throw new Error("REQUEST_ALREADY_SENT");

    const joinedCount = activeJoinedCount(group);
    if (joinedCount >= group.maxMembers) throw new Error("GROUP_FULL");

    existing.status =
      input.requesterUserId === announcement.ownerUserId || joinedCount === 0
        ? "joined"
        : "pending";
    existing.requestedAt = new Date();
    existing.joinedAt = existing.status === "joined" ? new Date() : null;
    if (existing.status === "joined") joinedMember = existing;
    group.isActive = true;
  } else {
    const joinedCount = activeJoinedCount(group);
    if (joinedCount >= group.maxMembers) throw new Error("GROUP_FULL");

    const joinsImmediately = joinedCount === 0;
    const newMember = {
      userId: input.requesterUserId,
      displayName: input.requesterDisplayName,
      status: joinsImmediately ? "joined" as const : "pending" as const,
      joinedAt: joinsImmediately ? new Date() : null,
      requestedAt: new Date(),
    };
    group.members.push(newMember);
    if (joinsImmediately) joinedMember = newMember;
    group.isActive = true;
  }

  announcement.isActive = true;
  await announcement.save();
  await group.save();

  if (joinedMember) {
    await BuddyMessage.create({
      groupId: String(group._id),
      senderUserId: "system",
      senderDisplayName: "system",
      type: "system",
      text: `${joinedMember.displayName} joined the group.`,
    });

    io.to(String(group._id)).emit("buddy:member_joined", {
      groupId: String(group._id),
      userId: joinedMember.userId,
      displayName: joinedMember.displayName,
    });
  } else {
    io.to(String(group._id)).emit("buddy:join_request", {
      groupId: String(group._id),
      requesterUserId: input.requesterUserId,
      requesterDisplayName: input.requesterDisplayName,
    });
  }

  return group;
}

export async function respondToJoinRequest(
  input: RespondToJoinRequestInput,
  io: SocketIOServer,
): Promise<IBuddyGroup> {
  const group = await BuddyGroup.findById(input.groupId);
  if (!group || !group.isActive) throw new Error("GROUP_NOT_FOUND");

  // Buddy reads have no owner — any joined member can approve or decline.
  const actor = group.members.find((m) => m.userId === input.actorUserId);
  if (!actor || actor.status !== "joined") throw new Error("FORBIDDEN");

  const target = group.members.find((m) => m.userId === input.targetUserId);
  if (!target || target.status !== "pending") throw new Error("REQUEST_NOT_FOUND");

  if (input.accept) {
    const announcement = await BuddyAnnouncement.findById(group.announcementId);
    if (!announcement || !isAnnouncementOpen(announcement))
      throw new Error("ANNOUNCEMENT_NOT_FOUND");

    const joinedCount = activeJoinedCount(group);
    if (joinedCount >= group.maxMembers) throw new Error("GROUP_FULL");

    target.status = "joined";
    target.joinedAt = new Date();

    const newJoinedCount = activeJoinedCount(group);
    if (newJoinedCount >= group.maxMembers) {
      await BuddyAnnouncement.findByIdAndUpdate(group.announcementId, {
        isActive: false,
      });
    }

    await BuddyMessage.create({
      groupId: String(group._id),
      senderUserId: "system",
      senderDisplayName: "system",
      type: "system",
      text: `${target.displayName} joined the group.`,
    });

    io.to(String(group._id)).emit("buddy:member_joined", {
      groupId: String(group._id),
      userId: target.userId,
      displayName: target.displayName,
    });
  } else {
    target.status = "left";

    io.to(String(group._id)).emit("buddy:join_declined", {
      groupId: String(group._id),
      userId: target.userId,
    });
  }

  await group.save();
  return group;
}

export async function leaveGroup(
  input: LeaveGroupInput,
  io: SocketIOServer,
): Promise<void> {
  const group = await BuddyGroup.findById(input.groupId);
  if (!group || !group.isActive) throw new Error("GROUP_NOT_FOUND");

  const member = assertMember(group, input.userId);
  member.status = "left";
  member.joinedAt = null;

  const joinedCount = activeJoinedCount(group);
  group.isActive = joinedCount > 0;

  const announcement = await BuddyAnnouncement.findById(group.announcementId);
  if (announcement && isAnnouncementOpen(announcement)) {
    if (announcement.ownerUserId === input.userId) {
      // The reader who posted this has left. Close the announcement so nobody
      // joins an ownerless read — an admin can reopen it if that was a mistake.
      announcement.isActive = false;
      announcement.status = "closed";
      announcement.closedAt = new Date();
    } else {
      announcement.isActive = joinedCount < group.maxMembers;
      announcement.expiresAt = new Date(Date.now() + ANNOUNCEMENT_TTL_MS);
    }
    await announcement.save();
  }

  await BuddyMessage.create({
    groupId: String(group._id),
    senderUserId: "system",
    senderDisplayName: "system",
    type: "system",
    text: `${member.displayName} left the group.`,
  });

  await group.save();

  io.to(String(group._id)).emit("buddy:member_left", {
    groupId: String(group._id),
    userId: input.userId,
    displayName: member.displayName,
  });
}

export async function getGroup(
  groupId: string,
  userId: string,
): Promise<IBuddyGroup> {
  const group = await BuddyGroup.findById(groupId);
  if (!group) throw new Error("GROUP_NOT_FOUND");
  assertMember(group, userId);
  return group;
}

/**
 * All groups the user is currently a joined member of, newest activity first.
 *
 * Intentionally does NOT filter on `isActive`. That flag is derived from
 * membership and has historically gone stale, which silently hid groups the
 * user was still a member of. Membership status is the source of truth.
 */
export async function getMyGroups(userId: string): Promise<IBuddyGroup[]> {
  return BuddyGroup.find({
    members: { $elemMatch: { userId, status: "joined" } },
  }).sort({ updatedAt: -1 });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function sendMessage(
  input: SendMessageInput,
  io: SocketIOServer,
): Promise<IBuddyMessage> {
  const group = await BuddyGroup.findById(input.groupId);
  if (!group || !group.isActive) throw new Error("GROUP_NOT_FOUND");
  assertMember(group, input.senderUserId);

  const message = await BuddyMessage.create({
    groupId: input.groupId,
    senderUserId: input.senderUserId,
    senderDisplayName: input.senderDisplayName,
    type: input.type ?? "text",
    text: input.text,
    progressChapter: input.progressChapter ?? null,
    progressPage: input.progressPage ?? null,
  });

  io.to(input.groupId).emit("buddy:message", {
    groupId: input.groupId,
    message: {
      _id: String(message._id),
      senderUserId: message.senderUserId,
      senderDisplayName: message.senderDisplayName,
      type: message.type,
      text: message.text,
      progressChapter: message.progressChapter,
      progressPage: message.progressPage,
      createdAt: message.createdAt,
    },
  });

  return message;
}

export async function getMessages(
  input: GetMessagesInput,
): Promise<IBuddyMessage[]> {
  const group = await BuddyGroup.findById(input.groupId);
  if (!group) throw new Error("GROUP_NOT_FOUND");
  assertMember(group, input.userId);

  const limit = Math.min(input.limit ?? 50, 100);

  const query: Record<string, unknown> = { groupId: input.groupId };
  if (input.before) {
    query["_id"] = { $lt: input.before };
  }

  return BuddyMessage.find(query).sort({ _id: -1 }).limit(limit);
}
