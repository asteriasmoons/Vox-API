// src/routes/lurelia/rsvpRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import {
  setRSVP,
  getRSVPForUser,
  listRSVPs,
} from "../../services/lurelia/rsvpService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createRSVPRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /api/lurelia/events/:id/rsvp
  router.post("/:id/rsvp", async (req: Request, res: Response) => {
    try {
      const rsvp = await setRSVP(io, {
        ...req.body,
        sharedEventID: String(req.params.id),
      });
      return res.json({ success: true, rsvp });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events/:id/rsvp/mine?userID=...
  router.get("/:id/rsvp/mine", async (req: Request, res: Response) => {
    try {
      const userID = String(req.query.userID || "").trim();
      const rsvp = await getRSVPForUser(String(req.params.id), userID);
      return res.json({ success: true, rsvp });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events/:id/rsvps
  router.get("/:id/rsvps", async (req: Request, res: Response) => {
    try {
      const rsvps = await listRSVPs(String(req.params.id));
      return res.json({ success: true, rsvps });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
