// src/routes/lurelia/index.ts
//
// Composite router for the Lurelia shared event platform. Follows the
// factory pattern from `createBuddyRouter(io)` so the socket handle is
// available to each sub-router.

import { Router } from "express";
import { Server as SocketIOServer } from "socket.io";

import { createSharedEventRouter } from "./sharedEventRoutes";
import { createAttendeeRouter } from "./attendeeRoutes";
import { createInvitationRouter } from "./invitationRoutes";
import { createRSVPRouter } from "./rsvpRoutes";
import { createDiscussionRouter } from "./discussionRoutes";
import { createPostRouter } from "./postRoutes";
import { createMediaRouter } from "./mediaRoutes";
import { createNotificationRouter } from "./notificationRoutes";
import { createSyncRouter } from "./syncRoutes";

/** Status codes we map service-layer error strings to. Mirrors buddy-routes. */
export function mapErrorStatus(message: string): number {
  switch (message) {
    case "EVENT_NOT_FOUND":
    case "COMMENT_NOT_FOUND":
    case "REPLY_NOT_FOUND":
    case "POST_NOT_FOUND":
    case "ANNOUNCEMENT_NOT_FOUND":
    case "ATTENDEE_NOT_FOUND":
    case "INVITATION_NOT_FOUND":
    case "SUBSCRIPTION_NOT_FOUND":
    case "PARENT_NOT_FOUND":
    case "REQUEST_NOT_FOUND":
      return 404;
    case "FORBIDDEN":
    case "NOT_A_MEMBER":
    case "COMMENTS_DISABLED":
    case "DECLINED_CANNOT_COMMENT":
    case "GUEST_POSTS_DISABLED":
    case "RSVP_CHANGES_DISABLED":
    case "HOST_CANNOT_LEAVE_TRANSFER_FIRST":
    case "CANNOT_REMOVE_HOST":
    case "CANNOT_REMOVE_SELF":
      return 403;
    case "INVITATION_NOT_PENDING":
    case "INVITATION_EXPIRED":
    case "INVITATION_MISMATCH":
    case "NEW_HOST_NOT_ATTENDEE":
      return 409;
    default:
      return 400;
  }
}

export function createLureliaRouter(io: SocketIOServer): Router {
  const router = Router();

  router.use("/events", createSharedEventRouter(io));
  router.use("/events", createAttendeeRouter(io));
  router.use("/events", createInvitationRouter(io));
  router.use("/events", createRSVPRouter(io));
  router.use("/events", createDiscussionRouter(io));
  router.use("/events", createPostRouter(io));
  router.use("/media", createMediaRouter(io));
  router.use("/notifications", createNotificationRouter(io));
  router.use("/sync", createSyncRouter(io));

  return router;
}
