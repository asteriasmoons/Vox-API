// src/routes/lurelia/debugRoutes.ts
//
// DEBUG-ONLY endpoints for single-device verification of the shared
// event platform. Simulates a second participant so the client can
// exercise live sync and APNs delivery without a second Apple ID.
//
// Guarded by env var LURELIA_DEBUG_ENABLED. In production the router
// mounts a 404 shim instead so the endpoint effectively doesn't exist.

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";

import { joinEvent } from "../../services/lurelia/attendeeService";
import { setRSVP } from "../../services/lurelia/rsvpService";
import { createComment } from "../../services/lurelia/discussionService";
import {
  createPost,
  createAnnouncement,
} from "../../services/lurelia/postService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

function isDebugEnabled(): boolean {
  return String(process.env.LURELIA_DEBUG_ENABLED || "").toLowerCase() === "true";
}

const SIM_USER_ID = "u-sim-friend-1";
const SIM_USER_NAME = "Sim Friend";

/**
 * Ensure the simulated user is a member of the event before posting or
 * RSVPing as them. Safe to call repeatedly — `joinEvent` is idempotent.
 */
async function ensureSimJoined(io: SocketIOServer, sharedEventID: string) {
  try {
    await joinEvent(io, sharedEventID, SIM_USER_ID, SIM_USER_NAME);
  } catch (_e) {
    // If they already joined or approval is required, we don't care —
    // the caller will surface the real error from the actual sim step.
  }
}

export function createDebugRouter(io: SocketIOServer): Router {
  const router = Router();

  // Hard 404 unless the debug flag is on. Never shipped in production.
  router.use((_req, res, next) => {
    if (!isDebugEnabled()) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }
    next();
  });

  /**
   * POST /api/lurelia/events/:id/debug/simulate
   * Body: {
   *   kind: "join" | "rsvp" | "comment" | "hostPost" | "announcement",
   *   status?: "going" | "interested" | "declined",
   *   body?: string,   // custom comment / markdown body
   *   hostUserID?: string,       // for hostPost / announcement
   *   hostDisplayName?: string,  // for hostPost / announcement
   * }
   */
  router.post("/:id/debug/simulate", async (req: Request, res: Response) => {
    try {
      const eventID = String(req.params.id || "");
      const body = req.body ?? {};
      const kind = String(body.kind || "");

      switch (kind) {
        case "join": {
          const attendee = await joinEvent(
            io,
            eventID,
            SIM_USER_ID + "-" + randomUUID().slice(0, 6),
            SIM_USER_NAME,
          );
          return res.json({ success: true, kind, attendee });
        }
        case "rsvp": {
          await ensureSimJoined(io, eventID);
          const status = String(body.status || "going");
          const rsvp = await setRSVP(io, {
            sharedEventID: eventID,
            userID: SIM_USER_ID,
            displayName: SIM_USER_NAME,
            status: status as "going" | "interested" | "declined" | "pending",
          });
          return res.json({ success: true, kind, rsvp });
        }
        case "comment": {
          await ensureSimJoined(io, eventID);
          const commentBody =
            String(body.body || "").trim() ||
            "Hello from the sim friend at " + new Date().toLocaleTimeString();
          const comment = await createComment(io, {
            sharedEventID: eventID,
            authorUserID: SIM_USER_ID,
            authorDisplayName: SIM_USER_NAME,
            body: commentBody,
          });
          return res.json({ success: true, kind, comment });
        }
        case "hostPost": {
          const hostUserID = String(body.hostUserID || "");
          const hostDisplayName = String(body.hostDisplayName || "");
          if (!hostUserID || !hostDisplayName) {
            return res.status(400).json({
              success: false,
              error: "hostUserID_AND_hostDisplayName_REQUIRED",
            });
          }
          const bodyMD =
            String(body.body || "").trim() ||
            "# Test host post\n\nGenerated at " +
              new Date().toLocaleTimeString() +
              ".";
          const post = await createPost(io, {
            sharedEventID: eventID,
            authorUserID: hostUserID,
            authorDisplayName: hostDisplayName,
            bodyMarkdown: bodyMD,
            bodyHTML: "",
            isPinned: false,
          });
          return res.json({ success: true, kind, post });
        }
        case "announcement": {
          const hostUserID = String(body.hostUserID || "");
          const hostDisplayName = String(body.hostDisplayName || "");
          if (!hostUserID || !hostDisplayName) {
            return res.status(400).json({
              success: false,
              error: "hostUserID_AND_hostDisplayName_REQUIRED",
            });
          }
          const bodyMD =
            String(body.body || "").trim() ||
            "# Test announcement\n\nGenerated at " +
              new Date().toLocaleTimeString() +
              ".";
          const announcement = await createAnnouncement(io, {
            sharedEventID: eventID,
            authorUserID: hostUserID,
            authorDisplayName: hostDisplayName,
            bodyMarkdown: bodyMD,
            bodyHTML: "",
          });
          return res.json({ success: true, kind, announcement });
        }
        default:
          return res.status(400).json({
            success: false,
            error:
              "kind_MUST_BE_one_of_join_rsvp_comment_hostPost_announcement",
          });
      }
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
