// src/routes/lurelia/postRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import {
  createPost,
  listPosts,
  editPost,
  deletePost,
  createAnnouncement,
  listAnnouncements,
  editAnnouncement,
  deleteAnnouncement,
} from "../../services/lurelia/postService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createPostRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /api/lurelia/events/:id/posts
  router.post("/:id/posts", async (req: Request, res: Response) => {
    try {
      const post = await createPost(io, {
        ...req.body,
        sharedEventID: String(req.params.id),
      });
      return res.status(201).json({ success: true, post });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events/:id/posts
  router.get("/:id/posts", async (req: Request, res: Response) => {
    try {
      const posts = await listPosts(String(req.params.id));
      return res.json({ success: true, posts });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // PATCH /api/lurelia/events/posts/:postID
  router.patch("/posts/:postID", async (req: Request, res: Response) => {
    try {
      const { actorUserID, ...patch } = req.body;
      const post = await editPost(io, String(req.params.postID), actorUserID, patch);
      return res.json({ success: true, post });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // DELETE /api/lurelia/events/posts/:postID
  router.delete("/posts/:postID", async (req: Request, res: Response) => {
    try {
      const actorUserID = String(req.query.actorUserID || req.body.actorUserID);
      await deletePost(io, String(req.params.postID), actorUserID);
      return res.json({ success: true });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/events/:id/announcements
  router.post("/:id/announcements", async (req: Request, res: Response) => {
    try {
      const announcement = await createAnnouncement(io, {
        ...req.body,
        sharedEventID: String(req.params.id),
      });
      return res.status(201).json({ success: true, announcement });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/events/:id/announcements
  router.get("/:id/announcements", async (req: Request, res: Response) => {
    try {
      const announcements = await listAnnouncements(String(req.params.id));
      return res.json({ success: true, announcements });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // PATCH /api/lurelia/events/announcements/:announcementID
  router.patch(
    "/announcements/:announcementID",
    async (req: Request, res: Response) => {
      try {
        const { actorUserID, ...patch } = req.body;
        const announcement = await editAnnouncement(
          io,
          String(req.params.announcementID),
          actorUserID,
          patch,
        );
        return res.json({ success: true, announcement });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  // DELETE /api/lurelia/events/announcements/:announcementID
  router.delete(
    "/announcements/:announcementID",
    async (req: Request, res: Response) => {
      try {
        const actorUserID = String(req.query.actorUserID || req.body.actorUserID);
        await deleteAnnouncement(io, String(req.params.announcementID), actorUserID);
        return res.json({ success: true });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  return router;
}
