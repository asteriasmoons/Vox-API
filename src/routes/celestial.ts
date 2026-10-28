//
//  celestial.ts
//  Shared AI interpretation API for Sterium celestial / sky events.
//  Mounted at /api/celestial. No per-user auth: interpretations are shared
//  content keyed by a stable event fingerprint (matches the other spiritual
//  AI routes). Personal Calendar/Events stay on-device.
//

import { Router } from "express";
import {
  ensureGeneration,
  snapshot,
  regenerate,
} from "../services/celestial/celestialGenerationWorker";
import { CelestialEventPayload, computeFingerprint } from "../services/celestial/celestialTypes";

const router = Router();

function parseEvent(body: unknown): CelestialEventPayload | null {
  const event = (body as any)?.event ?? body;
  if (!event || typeof event !== "object") return null;
  const e = event as any;
  if (
    typeof e.id !== "string" ||
    typeof e.name !== "string" ||
    typeof e.type !== "string" ||
    typeof e.category !== "string" ||
    typeof e.peakDate !== "string"
  ) {
    return null;
  }
  if (Number.isNaN(new Date(e.peakDate).getTime())) return null;
  return e as CelestialEventPayload;
}

// Open an event: return existing interpretation or create/resume a job (only here).
router.post("/open", async (req, res) => {
  const event = parseEvent(req.body);
  if (!event) return res.status(400).json({ error: "A valid event payload is required" });
  try {
    const snap = await ensureGeneration(event);
    return res.json(snap);
  } catch (error) {
    console.error("[celestial] open error:", error);
    return res.status(500).json({ error: "Failed to prepare celestial interpretation" });
  }
});

// Poll progress / retrieve completed sections for a fingerprint.
router.get("/:fingerprint", async (req, res) => {
  const fingerprint = req.params.fingerprint;
  if (!/^[a-f0-9]{8,64}$/.test(fingerprint)) {
    return res.status(400).json({ error: "Invalid fingerprint" });
  }
  try {
    const snap = await snapshot(fingerprint);
    if (!snap) return res.status(404).json({ error: "No interpretation for this event yet" });
    return res.json(snap);
  } catch (error) {
    console.error("[celestial] snapshot error:", error);
    return res.status(500).json({ error: "Failed to load interpretation" });
  }
});

// Authorized regeneration of an outdated interpretation.
router.post("/regenerate", async (req, res) => {
  const requiredKey = process.env.CELESTIAL_REGEN_KEY;
  if (requiredKey && req.header("x-regenerate-key") !== requiredKey) {
    return res.status(403).json({ error: "Not authorized to regenerate" });
  }
  const event = parseEvent(req.body);
  if (!event) return res.status(400).json({ error: "A valid event payload is required" });
  try {
    const snap = await regenerate(event);
    return res.json(snap);
  } catch (error) {
    console.error("[celestial] regenerate error:", error);
    return res.status(500).json({ error: "Failed to regenerate interpretation" });
  }
});

// Convenience: compute the canonical fingerprint for a payload (client cross-check).
router.post("/fingerprint", (req, res) => {
  const event = parseEvent(req.body);
  if (!event) return res.status(400).json({ error: "A valid event payload is required" });
  return res.json({ fingerprint: computeFingerprint(event) });
});

export default router;
