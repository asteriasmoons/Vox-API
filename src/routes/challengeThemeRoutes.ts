import { Router, Request, Response } from "express";
import {
  ChallengeAIValidationPacket,
  ChallengeAIValidationResponse,
  validateChallengeTheme,
} from "../services/challengeThemeValidationService";
import {
  ChallengePhotoValidationPacket,
  ChallengePhotoValidationResponse,
  validateChallengePhoto,
} from "../services/challengePhotoValidationService";

const router = Router();

router.post(
  "/validate-theme",
  async (
    req: Request<
      {},
      ChallengeAIValidationResponse,
      ChallengeAIValidationPacket
    >,
    res: Response<ChallengeAIValidationResponse>,
  ) => {
    try {
      const packet = req.body;

      if (!packet.challengeTitle || typeof packet.challengeTitle !== "string") {
        return res.status(400).json({
          status: "needsMoreInfo",
          message: "Challenge title is required.",
        });
      }

      if (
        !packet.requirementText ||
        typeof packet.requirementText !== "string"
      ) {
        return res.status(400).json({
          status: "needsMoreInfo",
          message: "Challenge requirement is required.",
        });
      }

      if (!Array.isArray(packet.bookTitles) || packet.bookTitles.length === 0) {
        return res.status(400).json({
          status: "needsMoreInfo",
          message: "At least one linked book is required for validation.",
        });
      }

      const result = await validateChallengeTheme(packet);

      return res.status(200).json(result);
    } catch (error) {
      console.error("[challenges] Theme validation failed:", error);

      return res.status(500).json({
        status: "needsMoreInfo",
        message:
          "Could not validate this challenge right now. Please try again soon.",
      });
    }
  },
);

router.post(
  "/validate-photo",
  async (
    req: Request<
      {},
      ChallengePhotoValidationResponse,
      ChallengePhotoValidationPacket
    >,
    res: Response<ChallengePhotoValidationResponse>,
  ) => {
    try {
      const packet = req.body;

      if (!packet.challengeTitle || typeof packet.challengeTitle !== "string") {
        return res.status(400).json({
          status: "needsMoreInfo",
          message: "Challenge title is required.",
          confidence: 0,
          visibleEvidence: [],
          missingEvidence: ["Challenge title"],
        });
      }

      if (
        !packet.requirementText ||
        typeof packet.requirementText !== "string"
      ) {
        return res.status(400).json({
          status: "needsMoreInfo",
          message: "Challenge requirement is required.",
          confidence: 0,
          visibleEvidence: [],
          missingEvidence: ["Challenge requirement"],
        });
      }

      if (!packet.photoURL || typeof packet.photoURL !== "string") {
        return res.status(400).json({
          status: "needsMoreInfo",
          message: "A proof photo is required for photo validation.",
          confidence: 0,
          visibleEvidence: [],
          missingEvidence: ["Proof photo"],
        });
      }

      const result = await validateChallengePhoto(packet);

      return res.status(200).json(result);
    } catch (error) {
      console.error("[challenges] Photo validation failed:", error);

      return res.status(500).json({
        status: "needsMoreInfo",
        message:
          "Could not validate this photo right now. Please try again soon.",
        confidence: 0,
        visibleEvidence: [],
        missingEvidence: ["Validation service unavailable"],
      });
    }
  },
);

export default router;
