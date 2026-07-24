// src/routes/buddy-routes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";
import {
  postAnnouncement,
  getBoard,
  getMyAnnouncements,
  removeAnnouncement,
  archiveAnnouncement,
  closeAnnouncement,
  updateAnnouncement,
  requestToJoin,
  respondToJoinRequest,
  leaveGroup,
  getGroup,
  getMyGroup,
  sendMessage,
  getMessages,
} from "../services/buddy-service";
import { BuddyMessage } from "../models/BuddyMessage";

const ADMIN_USER_ID = "001664.f2fefbb84f024544b98e865fa6c6b49e.1524";

export function createBuddyRouter(io: SocketIOServer): Router {
  const router = Router();

  function handleError(res: Response, error: unknown) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    const status =
      message === "ANNOUNCEMENT_NOT_FOUND" ? 404
      : message === "ANNOUNCEMENT_CLOSED" ? 409
      : message === "ANNOUNCEMENT_LIMIT_REACHED" ? 409
      : message === "GROUP_NOT_FOUND" ? 404
      : message === "REQUEST_NOT_FOUND" ? 404
      : message === "FORBIDDEN" ? 403
      : message === "NOT_A_MEMBER" ? 403
      : message === "CANNOT_JOIN_OWN_ANNOUNCEMENT" ? 403
      : message === "GROUP_FULL" ? 409
      : message === "ALREADY_A_MEMBER" ? 409
      : message === "REQUEST_ALREADY_SENT" ? 409
      : 400;

    return res.status(status).json({ success: false, error: message });
  }

  function str(val: unknown): string {
    if (typeof val === "string") return val;
    if (Array.isArray(val) && typeof val[0] === "string") return val[0];
    return "";
  }

  // ── Announcement board ────────────────────────────────────────────────────

  router.post("/announcements", async (req: Request, res: Response) => {
    try {
      const announcement = await postAnnouncement(req.body);
      return res.status(201).json({ success: true, announcement });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/announcements", async (req: Request, res: Response) => {
    try {
      const currentUserId = str(req.query.userId) || undefined;
      const announcements = await getBoard(currentUserId);
      return res.json({ success: true, announcements });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/announcements/mine", async (req: Request, res: Response) => {
    try {
      const userId = str(req.query.userId);
      const announcements = await getMyAnnouncements(userId);
      return res.json({ success: true, announcements });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.patch("/announcements/:id", async (req: Request, res: Response) => {
    try {
      const announcement = await updateAnnouncement({
        announcementId: str(req.params.id),
        ownerUserId: req.body.ownerUserId,
        message: req.body.message,
        currentChapter: req.body.currentChapter,
        currentPage: req.body.currentPage,
        maxMembers: req.body.maxMembers,
      });
      return res.json({ success: true, announcement });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.delete("/announcements/:id", async (req: Request, res: Response) => {
    try {
      const ownerUserId = str(req.query.userId);
      await removeAnnouncement(str(req.params.id), ownerUserId);
      return res.json({ success: true });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/announcements/:id/archive", async (req: Request, res: Response) => {
    try {
      const announcement = await archiveAnnouncement({
        announcementId: str(req.params.id),
        ownerUserId: req.body.ownerUserId,
      });
      return res.json({ success: true, announcement });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/announcements/:id/close", async (req: Request, res: Response) => {
    try {
      const announcement = await closeAnnouncement({
        announcementId: str(req.params.id),
        ownerUserId: req.body.ownerUserId,
      });
      return res.json({ success: true, announcement });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // ── Groups ────────────────────────────────────────────────────────────────

  router.post("/groups/request", async (req: Request, res: Response) => {
    try {
      const group = await requestToJoin(
        {
          announcementId: req.body.announcementId,
          requesterUserId: req.body.requesterUserId,
          requesterDisplayName: req.body.requesterDisplayName,
        },
        io,
      );
      return res.status(201).json({ success: true, group });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/groups/:id/respond", async (req: Request, res: Response) => {
    try {
      const group = await respondToJoinRequest(
        {
          groupId: str(req.params.id),
          actorUserId: req.body.actorUserId,
          targetUserId: req.body.targetUserId,
          accept: req.body.accept,
        },
        io,
      );
      return res.json({ success: true, group });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/groups/:id/leave", async (req: Request, res: Response) => {
    try {
      await leaveGroup({ groupId: str(req.params.id), userId: req.body.userId }, io);
      return res.json({ success: true });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/groups/mine", async (req: Request, res: Response) => {
    try {
      const userId = str(req.query.userId);
      const group = await getMyGroup(userId);
      return res.json({ success: true, group });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/groups/:id", async (req: Request, res: Response) => {
    try {
      const userId = str(req.query.userId);
      const group = await getGroup(str(req.params.id), userId);
      return res.json({ success: true, group });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // ── Messages ──────────────────────────────────────────────────────────────

  router.post("/groups/:id/messages", async (req: Request, res: Response) => {
    try {
      const message = await sendMessage(
        {
          groupId: str(req.params.id),
          senderUserId: req.body.senderUserId,
          senderDisplayName: req.body.senderDisplayName,
          type: req.body.type,
          text: req.body.text,
          progressChapter: req.body.progressChapter,
          progressPage: req.body.progressPage,
        },
        io,
      );
      return res.status(201).json({ success: true, message });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/groups/:id/messages", async (req: Request, res: Response) => {
    try {
      const userId = str(req.query.userId);
      const before = str(req.query.before) || null;
      const limitRaw = str(req.query.limit);
      const limit = limitRaw ? parseInt(limitRaw, 10) : 50;

      const messages = await getMessages({
        groupId: str(req.params.id),
        userId,
        before,
        limit,
      });
      return res.json({ success: true, messages });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // DELETE /api/buddy/groups/:id/messages — admin only, clears all messages in a group
  router.delete("/groups/:id/messages", async (req: Request, res: Response) => {
    try {
      const userId = str(req.query.userId);
      if (userId !== ADMIN_USER_ID) {
        return res.status(403).json({ success: false, error: "FORBIDDEN" });
      }
      const groupId = str(req.params.id);
      await BuddyMessage.deleteMany({ groupId });
      io.to(groupId).emit("buddy:chat_cleared");
      return res.json({ success: true });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
