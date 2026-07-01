// src/routes/user-routes.ts

import { Router, Request, Response } from "express";
import { LumeyUserProfile, LunixiaUserProfile } from "../models/UserProfile";

const router = Router();

function str(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0];
  return "";
}

// POST /api/user/display-name
// Body: { userId, displayName }
router.post("/display-name", async (req: Request, res: Response) => {
  try {
    const userId = str(req.body.userId).trim();
    const displayName = str(req.body.displayName).trim();

    if (!userId) return res.status(400).json({ success: false, error: "MISSING_USER_ID" });
    if (!displayName) return res.status(400).json({ success: false, error: "MISSING_DISPLAY_NAME" });
    if (displayName.length > 30) return res.status(400).json({ success: false, error: "DISPLAY_NAME_TOO_LONG" });

    const [lumeyProfile] = await Promise.all([
      LumeyUserProfile.findOneAndUpdate(
        { userId },
        { displayName },
        { upsert: true, new: true },
      ),
      LunixiaUserProfile.findOneAndUpdate(
        { userId },
        { displayName },
        { upsert: true, new: true },
      ),
    ]);

    return res.json({ success: true, profile: lumeyProfile });
  } catch (error) {
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// GET /api/user/display-name/:userId
router.get("/display-name/:userId", async (req: Request, res: Response) => {
  try {
    const userId = str(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, error: "MISSING_USER_ID" });

    const profile =
      (await LumeyUserProfile.findOne({ userId })) ??
      (await LunixiaUserProfile.findOne({ userId }));

    return res.json({
      success: true,
      displayName: profile?.displayName ?? null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

export default router;
