// src/routes/sprint-routes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";
import {
  getActiveSprint,
  startSprint,
  joinSprint,
  submitEndPage,
  sendSprintMessage,
  getSprintMessages,
  getAllTimeLeaderboard,
  getUserLeaderboardEntry,
} from "../services/sprint-service";
import { SprintMessage } from "../models/SprintMessage";

const ADMIN_USER_ID = "001664.f2fefbb84f024544b98e865fa6c6b49e.1524";

export function createSprintRouter(io: SocketIOServer): Router {
  const router = Router();

  function str(val: unknown): string {
    if (typeof val === "string") return val;
    if (Array.isArray(val) && typeof val[0] === "string") return val[0];
    return "";
  }

  function handleError(res: Response, error: unknown) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    const status =
      message === "SPRINT_NOT_FOUND"
        ? 404
        : message === "SPRINT_ALREADY_ACTIVE"
          ? 409
          : message === "ALREADY_JOINED"
            ? 409
            : message === "ALREADY_SUBMITTED"
              ? 409
              : message === "SPRINT_FINISHED"
                ? 410
                : message === "SPRINT_NOT_IN_SUBMISSION"
                  ? 400
                  : message === "NOT_A_PARTICIPANT"
                    ? 403
                    : message === "FORBIDDEN"
                      ? 403
                      : 400;

    return res.status(status).json({ success: false, error: message });
  }

  // ── Sprint state ──────────────────────────────────────────────────────────

  router.get("/active", async (_req: Request, res: Response) => {
    try {
      const sprint = await getActiveSprint();
      return res.json({ success: true, sprint });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // ── Sprint actions ────────────────────────────────────────────────────────

  router.post("/start", async (req: Request, res: Response) => {
    try {
      const sprint = await startSprint(
        {
          userId: req.body.userId,
          displayName: req.body.displayName,
          durationMinutes: Number(req.body.durationMinutes),
          startPage: Number(req.body.startPage),
        },
        io,
      );
      return res.status(201).json({ success: true, sprint });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/:id/join", async (req: Request, res: Response) => {
    try {
      const sprint = await joinSprint(
        {
          sprintId: str(req.params.id),
          userId: req.body.userId,
          displayName: req.body.displayName,
          startPage: Number(req.body.startPage),
        },
        io,
      );
      return res.status(200).json({ success: true, sprint });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/:id/submit", async (req: Request, res: Response) => {
    try {
      const sprint = await submitEndPage(
        {
          sprintId: str(req.params.id),
          userId: req.body.userId,
          endPage: Number(req.body.endPage),
        },
        io,
      );
      return res.json({ success: true, sprint });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // ── Messages ──────────────────────────────────────────────────────────────

  router.post("/messages", async (req: Request, res: Response) => {
    try {
      const message = await sendSprintMessage(
        {
          senderUserId: req.body.senderUserId,
          senderDisplayName: req.body.senderDisplayName,
          text: req.body.text,
        },
        io,
      );
      return res.status(201).json({ success: true, message });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/messages", async (req: Request, res: Response) => {
    try {
      const before = str(req.query.before) || null;
      const limitRaw = str(req.query.limit);
      const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
      const messages = await getSprintMessages({ before, limit });
      return res.json({ success: true, messages });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // DELETE /api/sprint/messages — admin only, clears all sprint messages
  router.delete("/messages", async (req: Request, res: Response) => {
    try {
      const userId = str(req.query.userId);
      if (userId !== ADMIN_USER_ID) {
        return res.status(403).json({ success: false, error: "FORBIDDEN" });
      }
      await SprintMessage.deleteMany({});
      io.to("sprint:global").emit("sprint:chat_cleared");
      return res.json({ success: true });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // ── Leaderboard ───────────────────────────────────────────────────────────

  router.get("/leaderboard", async (_req: Request, res: Response) => {
    try {
      const leaderboard = await getAllTimeLeaderboard();
      return res.json({ success: true, leaderboard });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/leaderboard/:userId", async (req: Request, res: Response) => {
    try {
      const entry = await getUserLeaderboardEntry(str(req.params.userId));
      return res.json({ success: true, entry });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
