// src/routes/lurelia/notificationRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import {
  subscribe,
  unsubscribe,
  updatePreferences,
  listSubscriptions,
} from "../../services/lurelia/notificationService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createNotificationRouter(_io: SocketIOServer): Router {
  const router = Router();

  // POST /api/lurelia/notifications/subscribe
  router.post("/subscribe", async (req: Request, res: Response) => {
    try {
      const subscription = await subscribe(req.body);
      return res.status(201).json({ success: true, subscription });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/notifications/unsubscribe
  router.post("/unsubscribe", async (req: Request, res: Response) => {
    try {
      const { sharedEventID, userID, deviceToken } = req.body;
      const subscription = await unsubscribe(sharedEventID, userID, deviceToken);
      return res.json({ success: true, subscription });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // PATCH /api/lurelia/notifications/preferences
  router.patch("/preferences", async (req: Request, res: Response) => {
    try {
      const { sharedEventID, userID, deviceToken, enabledKinds } = req.body;
      const subscription = await updatePreferences(
        sharedEventID,
        userID,
        deviceToken,
        enabledKinds,
      );
      return res.json({ success: true, subscription });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/notifications/subscriptions/:eventID
  router.get(
    "/subscriptions/:eventID",
    async (req: Request, res: Response) => {
      try {
        const subscriptions = await listSubscriptions(String(req.params.eventID));
        return res.json({ success: true, subscriptions });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  return router;
}
