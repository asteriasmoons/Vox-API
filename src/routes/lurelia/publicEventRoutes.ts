import { Router, Request, Response } from "express";

import { getPublicEventPayload } from "../../services/lurelia/publicEventService";
import { mapErrorStatus } from "./index";

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return res
    .status(mapErrorStatus(message))
    .json({ success: false, error: message });
}

export function createPublicEventRouter(): Router {
  const router = Router();

  // GET /api/lurelia/public/events/:id
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const payload = await getPublicEventPayload(String(req.params.id));
      return res.json({ success: true, ...payload });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
