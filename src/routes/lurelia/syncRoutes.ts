// src/routes/lurelia/syncRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import { pullChanges } from "../../services/lurelia/syncService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createSyncRouter(_io: SocketIOServer): Router {
  const router = Router();

  // GET /api/lurelia/sync/:eventID?since=ISO8601
  router.get("/:eventID", async (req: Request, res: Response) => {
    try {
      const bundle = await pullChanges({
        sharedEventID: String(req.params.eventID),
        since: req.query.since ? String(req.query.since) : null,
      });
      return res.json({ success: true, ...bundle });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
