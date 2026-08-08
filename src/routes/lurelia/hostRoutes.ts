// src/routes/lurelia/hostRoutes.ts
//
// Host-only endpoints added in Prompt 1B: ban/unban attendees, promote /
// demote co-hosts, close/reopen registration, permissions patch,
// discussion lock toggle, and event duplication. Existing routes
// (cancel, updateEvent, transferOwnership, removeAttendee, etc.) are
// left in their original files untouched — this router only holds
// genuinely new endpoints.

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import {
  banAttendee,
  unbanAttendee,
  listBannedAttendees,
  promoteToCoHost,
  demoteCoHost,
} from "../../services/lurelia/attendeeService";
import {
  setRegistrationClosed,
  duplicateSharedEvent,
} from "../../services/lurelia/sharedEventService";
import {
  getPermissions,
  updatePermissions,
  setDiscussionLocked,
} from "../../services/lurelia/permissionsService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createHostRouter(io: SocketIOServer): Router {
  const router = Router();

  // ── Attendee moderation ──────────────────────────────────────────────

  router.post("/:id/attendees/:userID/ban", async (req: Request, res: Response) => {
    try {
      const attendee = await banAttendee(
        io,
        String(req.params.id),
        String(req.body.actorUserID),
        String(req.params.userID),
        String(req.body.reason || ""),
      );
      return res.json({ success: true, attendee });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/:id/attendees/:userID/unban", async (req: Request, res: Response) => {
    try {
      const attendee = await unbanAttendee(
        io,
        String(req.params.id),
        String(req.body.actorUserID),
        String(req.params.userID),
      );
      return res.json({ success: true, attendee });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/:id/attendees/banned", async (req: Request, res: Response) => {
    try {
      const attendees = await listBannedAttendees(String(req.params.id));
      return res.json({ success: true, attendees });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/:id/attendees/:userID/promote", async (req: Request, res: Response) => {
    try {
      const attendee = await promoteToCoHost(
        io,
        String(req.params.id),
        String(req.body.actorUserID),
        String(req.params.userID),
      );
      return res.json({ success: true, attendee });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/:id/attendees/:userID/demote", async (req: Request, res: Response) => {
    try {
      const attendee = await demoteCoHost(
        io,
        String(req.params.id),
        String(req.body.actorUserID),
        String(req.params.userID),
      );
      return res.json({ success: true, attendee });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // ── Event settings ───────────────────────────────────────────────────

  router.post("/:id/registration", async (req: Request, res: Response) => {
    try {
      const event = await setRegistrationClosed(
        io,
        String(req.params.id),
        String(req.body.actorUserID),
        !!req.body.closed,
      );
      return res.json({ success: true, event });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/:id/duplicate", async (req: Request, res: Response) => {
    try {
      const event = await duplicateSharedEvent(
        io,
        String(req.params.id),
        String(req.body.actorUserID),
      );
      return res.status(201).json({ success: true, event });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // ── Permissions ──────────────────────────────────────────────────────

  router.get("/:id/permissions", async (req: Request, res: Response) => {
    try {
      const permissions = await getPermissions(String(req.params.id));
      return res.json({ success: true, permissions });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.patch("/:id/permissions", async (req: Request, res: Response) => {
    try {
      const { actorUserID, ...patch } = req.body;
      const permissions = await updatePermissions(
        io,
        String(req.params.id),
        String(actorUserID),
        patch,
      );
      return res.json({ success: true, permissions });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/:id/discussion", async (req: Request, res: Response) => {
    try {
      const permissions = await setDiscussionLocked(
        io,
        String(req.params.id),
        String(req.body.actorUserID),
        !!req.body.locked,
      );
      return res.json({ success: true, permissions });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
