// src/routes/lurelia/attendeeRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import {
  listAttendees,
  searchAttendees,
  joinEvent,
  approveJoinRequest,
  leaveEvent,
  removeAttendee,
  transferOwnership,
} from "../../services/lurelia/attendeeService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createAttendeeRouter(io: SocketIOServer): Router {
  const router = Router();

  // GET /api/lurelia/events/:id/attendees
  router.get("/:id/attendees", async (req: Request, res: Response) => {
    try {
      const attendees = await listAttendees(String(req.params.id));
      return res.json({ success: true, attendees });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events/:id/attendees/search?q=...
  router.get("/:id/attendees/search", async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || "");
      const attendees = await searchAttendees(String(req.params.id), q);
      return res.json({ success: true, attendees });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/events/:id/join
  router.post("/:id/join", async (req: Request, res: Response) => {
    try {
      const { userID, displayName, avatarURL } = req.body;
      const attendee = await joinEvent(
        io,
        String(req.params.id),
        userID,
        displayName,
        avatarURL,
      );
      return res.status(201).json({ success: true, attendee });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/events/:id/join/approve
  router.post("/:id/join/approve", async (req: Request, res: Response) => {
    try {
      const { actorUserID, targetUserID } = req.body;
      const attendee = await approveJoinRequest(
        io,
        String(req.params.id),
        actorUserID,
        targetUserID,
      );
      return res.json({ success: true, attendee });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/events/:id/leave
  router.post("/:id/leave", async (req: Request, res: Response) => {
    try {
      const { userID } = req.body;
      const attendee = await leaveEvent(io, String(req.params.id), userID);
      return res.json({ success: true, attendee });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // DELETE /api/lurelia/events/:id/attendees/:userID
  router.delete(
    "/:id/attendees/:userID",
    async (req: Request, res: Response) => {
      try {
        const actorUserID = String(req.query.actorUserID || req.body.actorUserID);
        const attendee = await removeAttendee(
          io,
          String(req.params.id),
          actorUserID,
          String(req.params.userID),
        );
        return res.json({ success: true, attendee });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  // POST /api/lurelia/events/:id/transfer
  router.post("/:id/transfer", async (req: Request, res: Response) => {
    try {
      const { currentHostUserID, newHostUserID } = req.body;
      const result = await transferOwnership(
        io,
        String(req.params.id),
        currentHostUserID,
        newHostUserID,
      );
      return res.json({ success: true, ...result });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
