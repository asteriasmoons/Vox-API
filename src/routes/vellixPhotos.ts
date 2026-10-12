import { Router } from "express";
import { createVellixPhotoService, VellixPhotoError } from "../services/vellixPhotoService";

const router = Router();
const photos = createVellixPhotoService();

router.get("/", async (req, res) => {
  try {
    if (req.query.q !== undefined && typeof req.query.q !== "string") return res.status(400).json({ error: "Invalid search query." });
    const page = Number(req.query.page || 1);
    if (!Number.isFinite(page) || page < 1 || !Number.isInteger(page)) return res.status(400).json({ error: "Invalid page." });
    return res.json(await photos.search(String(req.query.q || ""), page, req.query.shuffle === "true"));
  } catch (error) {
    return res.status(error instanceof VellixPhotoError ? error.status : 502).json({ error: error instanceof VellixPhotoError ? error.message : "Photo search is unavailable." });
  }
});

router.post("/:id/selection", async (req, res) => {
  try {
    await photos.trackSelection(String(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    return res.status(error instanceof VellixPhotoError ? error.status : 502).json({ error: error instanceof VellixPhotoError ? error.message : "Photo selection could not be saved." });
  }
});

export default router;
