import { Router } from "express";
import {
  generateCurrentCorrespondences,
} from "../services/currentCorrespondencesService";
import type { CurrentCorrespondencesInput } from "../services/currentCorrespondencesService";

const router = Router();

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

// POST /api/spiritual/current-correspondences
router.post("/", async (req, res) => {
  try {
    const planetaryDay = optionalString(req.body?.planetaryDay);

    if (!planetaryDay) {
      return res.status(400).json({ error: "planetaryDay is required" });
    }

    const date = optionalString(req.body?.date);
    const weekday = optionalString(req.body?.weekday);
    const planetaryHour = optionalString(req.body?.planetaryHour);
    const nextPlanetaryHour = optionalString(req.body?.nextPlanetaryHour);
    const moonPhase = optionalString(req.body?.moonPhase);
    const moonSign = optionalString(req.body?.moonSign);
    const moonIlluminationPercent = optionalNumber(
      req.body?.moonIlluminationPercent,
    );
    const upcomingSabbat = optionalString(req.body?.upcomingSabbat);
    const daysUntilSabbat = optionalNumber(req.body?.daysUntilSabbat);

    const input: CurrentCorrespondencesInput = {
      planetaryDay,
      ...(date !== undefined && { date }),
      ...(weekday !== undefined && { weekday }),
      ...(planetaryHour !== undefined && { planetaryHour }),
      ...(nextPlanetaryHour !== undefined && { nextPlanetaryHour }),
      ...(moonPhase !== undefined && { moonPhase }),
      ...(moonSign !== undefined && { moonSign }),
      ...(moonIlluminationPercent !== undefined && {
        moonIlluminationPercent,
      }),
      ...(upcomingSabbat !== undefined && { upcomingSabbat }),
      ...(daysUntilSabbat !== undefined && { daysUntilSabbat }),
    };

    console.log("[current-correspondences] request", input);

    const correspondences = await generateCurrentCorrespondences(input);

    console.log("[current-correspondences] response", {
      planet: correspondences.planet,
      element: correspondences.element,
      color: correspondences.color,
      crystal: correspondences.crystal,
      herb: correspondences.herb,
    });

    return res.json(correspondences);
  } catch (error) {
    console.error("[current-correspondences] error:", error);

    const message = error instanceof Error ? error.message : String(error);

    if (message === "Missing GROQ_API_KEY") {
      return res.status(500).json({ error: message });
    }

    return res.status(500).json({
      error: "Failed to generate current correspondences",
    });
  }
});

export default router;
