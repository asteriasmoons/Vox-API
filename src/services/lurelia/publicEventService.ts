import { Model } from "mongoose";

import { LureliaSharedEvent as SharedEventRaw } from "../../models/lurelia/SharedEvent";
import { LureliaEventArtwork as EventArtworkRaw } from "../../models/lurelia/EventArtwork";
import { LureliaAttendee as AttendeeRaw } from "../../models/lurelia/Attendee";
import { LureliaRSVP as RSVPRaw } from "../../models/lurelia/RSVP";
import { LureliaComment as CommentRaw } from "../../models/lurelia/Comment";
import { LureliaEventPost as EventPostRaw } from "../../models/lurelia/EventPost";
import { LureliaAnnouncement as AnnouncementRaw } from "../../models/lurelia/Announcement";

const SharedEvent = SharedEventRaw as Model<any>;
const EventArtwork = EventArtworkRaw as Model<any>;
const Attendee = AttendeeRaw as Model<any>;
const RSVP = RSVPRaw as Model<any>;
const Comment = CommentRaw as Model<any>;
const EventPost = EventPostRaw as Model<any>;
const Announcement = AnnouncementRaw as Model<any>;

function activeAttendeeFilter(sharedEventID: string) {
  return {
    sharedEventID,
    role: { $ne: "banned" },
    $or: [{ removedAt: null }, { removedAt: { $exists: false } }],
  };
}

function activeContentFilter(sharedEventID: string) {
  return {
    sharedEventID,
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
  };
}

function summarizeRSVPs(rsvps: any[]) {
  return rsvps.reduce(
    (summary, rsvp) => {
      const status = String(rsvp.status || "pending");
      if (status === "going") summary.going += 1;
      else if (status === "interested") summary.interested += 1;
      else if (status === "declined") summary.declined += 1;
      else summary.pending += 1;
      summary.total += 1 + Number(rsvp.plusOneCount || 0);
      return summary;
    },
    { going: 0, interested: 0, declined: 0, pending: 0, total: 0 },
  );
}

export async function getPublicEventPayload(sharedEventID: string) {
  const event = await SharedEvent.findById(sharedEventID).lean<any>();
  if (!event) throw new Error("EVENT_NOT_FOUND");

  const [
    primaryArtwork,
    attendeesPreview,
    rsvps,
    discussionPreview,
    postsPreview,
    announcementsPreview,
  ] = await Promise.all([
    EventArtwork.findOne({ sharedEventID, isPrimary: true })
      .sort({ updatedAt: -1 })
      .lean(),
    Attendee.find(activeAttendeeFilter(sharedEventID))
      .sort({ role: 1, joinedAt: 1, createdAt: 1 })
      .limit(8)
      .lean(),
    RSVP.find({ sharedEventID }).sort({ updatedAt: -1 }).lean(),
    Comment.find({ ...activeContentFilter(sharedEventID), eventPostID: "" })
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(3)
      .lean(),
    EventPost.find(activeContentFilter(sharedEventID))
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(3)
      .lean(),
    Announcement.find(activeContentFilter(sharedEventID))
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(3)
      .lean(),
  ]);

  const fallbackArtwork =
    primaryArtwork ||
    (await EventArtwork.findOne({ sharedEventID })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean());

  return {
    event,
    artwork: fallbackArtwork || null,
    attendeesPreview,
    rsvpSummary: summarizeRSVPs(rsvps),
    discussionPreview,
    postsPreview,
    announcementsPreview,
  };
}
