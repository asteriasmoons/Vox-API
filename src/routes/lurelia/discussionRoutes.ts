// src/routes/lurelia/discussionRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import {
  createComment,
  listComments,
  editComment,
  deleteComment,
  pinComment,
  createReply,
  listReplies,
  editReply,
  deleteReply,
  toggleReaction,
} from "../../services/lurelia/discussionService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createDiscussionRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /api/lurelia/events/:id/comments
  router.post("/:id/comments", async (req: Request, res: Response) => {
    try {
      const comment = await createComment(io, {
        ...req.body,
        sharedEventID: String(req.params.id),
      });
      return res.status(201).json({ success: true, comment });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events/:id/comments?eventPostID=...
  router.get("/:id/comments", async (req: Request, res: Response) => {
    try {
      const eventPostID = req.query.eventPostID
        ? String(req.query.eventPostID)
        : undefined;
      const viewerUserID = req.query.viewerUserID
        ? String(req.query.viewerUserID)
        : undefined;
      const comments = await listComments(
        String(req.params.id),
        eventPostID,
        viewerUserID,
      );
      return res.json({ success: true, comments });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // PATCH /api/lurelia/events/comments/:commentID
  router.patch("/comments/:commentID", async (req: Request, res: Response) => {
    try {
      const comment = await editComment(
        io,
        String(req.params.commentID),
        req.body.actorUserID,
        req.body.body,
      );
      return res.json({ success: true, comment });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // DELETE /api/lurelia/events/comments/:commentID
  router.delete("/comments/:commentID", async (req: Request, res: Response) => {
    try {
      const actorUserID = String(req.query.actorUserID || req.body.actorUserID);
      await deleteComment(io, String(req.params.commentID), actorUserID);
      return res.json({ success: true });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/events/comments/:commentID/pin
  router.post(
    "/comments/:commentID/pin",
    async (req: Request, res: Response) => {
      try {
        const comment = await pinComment(
          io,
          String(req.params.commentID),
          req.body.actorUserID,
          !!req.body.isPinned,
        );
        return res.json({ success: true, comment });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  // POST /api/lurelia/events/comments/:commentID/replies
  router.post(
    "/comments/:commentID/replies",
    async (req: Request, res: Response) => {
      try {
        const reply = await createReply(io, {
          ...req.body,
          parentCommentID: String(req.params.commentID),
        });
        return res.status(201).json({ success: true, reply });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  // GET /api/lurelia/events/comments/:commentID/replies
  router.get(
    "/comments/:commentID/replies",
    async (req: Request, res: Response) => {
      try {
        const viewerUserID = req.query.viewerUserID
          ? String(req.query.viewerUserID)
          : undefined;
        const replies = await listReplies(
          String(req.params.commentID),
          viewerUserID,
        );
        return res.json({ success: true, replies });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  // PATCH /api/lurelia/events/replies/:replyID
  router.patch("/replies/:replyID", async (req: Request, res: Response) => {
    try {
      const reply = await editReply(
        io,
        String(req.params.replyID),
        req.body.actorUserID,
        req.body.body,
      );
      return res.json({ success: true, reply });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // DELETE /api/lurelia/events/replies/:replyID
  router.delete("/replies/:replyID", async (req: Request, res: Response) => {
    try {
      const actorUserID = String(req.query.actorUserID || req.body.actorUserID);
      await deleteReply(io, String(req.params.replyID), actorUserID);
      return res.json({ success: true });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/events/reactions
  router.post("/reactions", async (req: Request, res: Response) => {
    try {
      const result = await toggleReaction(io, req.body);
      return res.json({ success: true, ...result });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
