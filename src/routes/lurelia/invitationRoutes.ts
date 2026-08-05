// src/routes/lurelia/invitationRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import {
  createInvitation,
  listInvitationsForEvent,
  listInvitationsForUser,
  acceptInvitation,
  declineInvitation,
  revokeInvitation,
} from "../../services/lurelia/invitationService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createInvitationRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /api/lurelia/events/:id/invitations
  router.post("/:id/invitations", async (req: Request, res: Response) => {
    try {
      const invitation = await createInvitation(io, {
        ...req.body,
        sharedEventID: String(req.params.id),
      });
      return res.status(201).json({ success: true, invitation });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events/:id/invitations
  router.get("/:id/invitations", async (req: Request, res: Response) => {
    try {
      const invitations = await listInvitationsForEvent(String(req.params.id));
      return res.json({ success: true, invitations });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events/invitations/mine?userID=...
  router.get("/invitations/mine", async (req: Request, res: Response) => {
    try {
      const userID = String(req.query.userID || "").trim();
      if (!userID) {
        return res
          .status(400)
          .json({ success: false, error: "userID_REQUIRED" });
      }
      const invitations = await listInvitationsForUser(userID);
      return res.json({ success: true, invitations });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/events/invitations/:token/accept
  router.post(
    "/invitations/:token/accept",
    async (req: Request, res: Response) => {
      try {
        const { userID, displayName, avatarURL } = req.body;
        const result = await acceptInvitation(
          io,
          String(req.params.token),
          userID,
          displayName,
          avatarURL,
        );
        return res.json({ success: true, ...result });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  // POST /api/lurelia/events/invitations/:token/decline
  router.post(
    "/invitations/:token/decline",
    async (req: Request, res: Response) => {
      try {
        const invitation = await declineInvitation(
          io,
          String(req.params.token),
          req.body.userID,
        );
        return res.json({ success: true, invitation });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  // POST /api/lurelia/events/invitations/:token/revoke
  router.post(
    "/invitations/:token/revoke",
    async (req: Request, res: Response) => {
      try {
        const invitation = await revokeInvitation(
          io,
          String(req.params.token),
          req.body.actorUserID,
        );
        return res.json({ success: true, invitation });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  return router;
}
