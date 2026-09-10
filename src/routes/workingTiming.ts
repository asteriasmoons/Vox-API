import { Router } from "express";
import { generateWorkingTimingProfile } from "../services/workingTimingProfileService";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const intention =
      typeof req.body?.intention === "string" ? req.body.intention.trim() : "";

    if (!intention) {
      return res.status(400).json({ error: "intention is required" });
    }

    if (intention.length > 500) {
      return res.status(400).json({ error: "intention is too long" });
    }

    console.log("[working-timing] request", { intention });

    const profile = await generateWorkingTimingProfile(intention);

    console.log("[working-timing] response", {
      primaryIntention: profile.primaryIntention,
      planetaryRulers: profile.planetaryRulers,
      favorableMoonPhases: profile.favorableMoonPhases,
      favorableNumerologyNumbers: profile.favorableNumerologyNumbers,
      favorableAspects: profile.favorableAspects,
    });
    return res.json(profile);
  } catch (error) {
    console.error("[working-timing] error:", error);

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("Missing GROQ_API_KEY")) {
      return res.status(500).json({ error: "Missing GROQ_API_KEY" });
    }

    return res.status(500).json({
      error: "Failed to generate working timing profile",
    });
  }
});

export default router;
