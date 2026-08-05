// src/routes/lurelia/mediaRoutes.ts

import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";
import multer from "multer";

import { uploadImage, uploadFile } from "../../services/lurelia/mediaService";

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

  return router;
}
