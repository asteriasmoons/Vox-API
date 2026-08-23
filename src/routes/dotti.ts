import { Router } from "express";
import {
  generateDottiSuggestions,
  parseDottiInput,
} from "../services/generateDottiSuggestions";

const router = Router();

// POST /api/dotti/suggestions
router.post("/suggestions", async (req, res) => {
  let input;
  try {
    input = parseDottiInput(req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return res.status(400).json({ error: message });
  }

  try {
    const result = await generateDottiSuggestions(input);
    return res.json(result);
  } catch (error) {
    console.error("Dotti suggestions generation error:", error);
    return res.status(500).json({ error: "Failed to generate Dotti suggestions" });
  }
});

export default router;
