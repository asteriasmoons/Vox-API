// src/routes/lurelia/mediaRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";
import multer from "multer";

import {
  uploadImage,
  uploadFile,
  uploadProfileAvatar,
} from "../../services/lurelia/mediaService";

import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createMediaRouter(_io: SocketIOServer): Router {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  // POST /api/lurelia/media/image
  // form-data: image (file), target (json string), uploaderUserID, filename?, isInline?
  router.post("/image", upload.single("image"), async (req: Request, res: Response) => {
    try {
      if (!req.file) throw new Error("no_image");
      const target = JSON.parse(String(req.body.target || "{}"));
      const uploaderUserID = String(req.body.uploaderUserID || "");
      const filename = String(req.body.filename || req.file.originalname || "");
      const isInline = String(req.body.isInline || "false") === "true";
      const asset = await uploadImage(
        req.file.buffer,
        target,
        uploaderUserID,
        filename,
        isInline,
      );
      return res.status(201).json({ success: true, asset });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/media/profile-avatar
  // form-data: avatar (file), uploaderUserID
  router.post("/profile-avatar", upload.single("avatar"), async (req: Request, res: Response) => {
    try {
      if (!req.file) throw new Error("no_avatar");
      const uploaderUserID = String(req.body.uploaderUserID || "");
      const asset = await uploadProfileAvatar(req.file.buffer, uploaderUserID);
      return res.status(201).json({ success: true, avatarURL: asset.avatarURL, asset });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // POST /api/lurelia/media/file
  router.post("/file", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) throw new Error("no_file");
      const target = JSON.parse(String(req.body.target || "{}"));
      const uploaderUserID = String(req.body.uploaderUserID || "");
      const filename = String(req.body.filename || req.file.originalname || "");
      const mimeType = String(req.body.mimeType || req.file.mimetype || "application/octet-stream");
      const asset = await uploadFile(
        req.file.buffer,
        target,
        uploaderUserID,
        filename,
        mimeType,
      );
      return res.status(201).json({ success: true, asset });
    } catch (error) {
      return handleError(res, error);
    }
  });

  // GET /api/lurelia/media/batch?ids=<comma-separated attachment IDs>
  // Cheap lookup used by client to hydrate attachment metadata when
  // rendering comments loaded from the server. No auth beyond the
  // parent router — attachments are event-scoped and IDs are opaque.
  router.get("/batch", async (req: Request, res: Response) => {
    try {
      const raw = String(req.query.ids || "").trim();
      if (!raw) return res.json({ success: true, attachments: [] });
      const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return res.json({ success: true, attachments: [] });
      const attachments = await Attachment.find({ _id: { $in: ids } }).lean();
      return res.json({ success: true, attachments });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
