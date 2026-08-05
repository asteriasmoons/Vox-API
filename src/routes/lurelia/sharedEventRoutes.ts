// src/routes/lurelia/sharedEventRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import {
  createSharedEvent,
  getSharedEvent,
  updateSharedEvent,
  cancelSharedEvent,
  listEventsForUser,
} from "../../services/lurelia/sharedEventService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createSharedEventRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /api/lurelia/events
  router.post("/", async (req: Request, res: Response) => {
    try {
      const event = await createSharedEvent(io, req.body);
      return res.status(201).json({ success: true, event });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events?userID=...
  router.get("/", async (req: Request, res: Response) => {
    try {
      const userID = String(req.query.userID || "").trim();
      if (!userID) {
        return res.status(400).json({ success: false, error: "userID_REQUIRED" });
      }
      const events = await listEventsForUser(userID);
      return res.json({ success: true, events });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events/:id
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const event = await getSharedEvent(String(req.params.id));
      return res.json({ success: true, event });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // PATCH /api/lurelia/events/:id
  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const { actorUserID, ...patch } = req.body;
      const event = await updateSharedEvent(io, String(req.params.id), actorUserID, patch);
      return res.json({ success: true, event });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/events/:id/cancel
  router.post("/:id/cancel", async (req: Request, res: Response) => {
    try {
      const event = await cancelSharedEvent(
        io,
        String(req.params.id),
        req.body.actorUserID,
        req.body.reason,
      );
      return res.json({ success: true, event });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
