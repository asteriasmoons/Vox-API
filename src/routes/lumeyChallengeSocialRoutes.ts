import { Router, Request, Response } from "express";
import {
  createSubmission,
  getChallengeFeed,
  toggleLike,
  addComment,
  deleteComment,
  getUserProfile,
  updateUserProfile,
} from "../services/lumeyChallengeSocialService";

const router = Router();

/**
 * GET /api/lumey/challenges/feed
 */
router.get("/feed", async (_req: Request, res: Response) => {
  try {
    const feed = await getChallengeFeed();

    return res.status(200).json(feed);
  } catch (error) {
    console.error("[lumey-challenges] feed:", error);

    return res.status(500).json({
      message: "Unable to load the challenge feed.",
    });
  }
});

/**
 * POST /api/lumey/challenges/submissions
 */
router.post("/submissions", async (req: Request, res: Response) => {
  try {
    const submission = await createSubmission(req.body);

    return res.status(201).json(submission);
  } catch (error: any) {
    console.error("[lumey-challenges] create submission:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to create submission.",
    });
  }
});

/**
 * POST /api/lumey/challenges/submissions/:submissionID/like
 */
router.post(
  "/submissions/:submissionID/like",
  async (req: Request, res: Response) => {
    try {
      const submissionID = String(req.params.submissionID || "").trim();

      if (!submissionID) {
        return res.status(400).json({
          message: "submissionID is required.",
        });
      }

      const result = await toggleLike({
        submissionID,
        userID: req.body.userID,
      });

      return res.status(200).json(result);
    } catch (error: any) {
      console.error("[lumey-challenges] like:", error);

      return res.status(400).json({
        message: error?.message ?? "Unable to update like.",
      });
    }
  },
);

/**
 * POST /api/lumey/challenges/submissions/:submissionID/comments
 */
router.post(
  "/submissions/:submissionID/comments",
  async (req: Request, res: Response) => {
    try {
      const submissionID = String(req.params.submissionID || "").trim();

      if (!submissionID) {
        return res.status(400).json({
          message: "submissionID is required.",
        });
      }

      const comment = await addComment({
        submissionID,
        userID: req.body.userID,
        username: req.body.username,
        text: req.body.text,
      });

      return res.status(201).json(comment);
    } catch (error: any) {
      console.error("[lumey-challenges] add comment:", error);

      return res.status(400).json({
        message: error?.message ?? "Unable to add comment.",
      });
    }
  },
);

/**
 * DELETE /api/lumey/challenges/comments/:commentID
 */
router.delete("/comments/:commentID", async (req: Request, res: Response) => {
  try {
    const commentID = String(req.params.commentID || "").trim();

    if (!commentID) {
      return res.status(400).json({
        message: "commentID is required.",
      });
    }

    await deleteComment(commentID);

    return res.sendStatus(204);
  } catch (error: any) {
    console.error("[lumey-challenges] delete comment:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to delete comment.",
    });
  }
});

/**
 * GET /api/lumey/challenges/profiles/:userID
 */
router.get("/profiles/:userID", async (req: Request, res: Response) => {
  try {
    const userID = String(req.params.userID || "").trim();

    if (!userID) {
      return res.status(400).json({
        message: "userID is required.",
      });
    }

    const profile = await getUserProfile(userID);

    return res.status(200).json(profile);
  } catch (error: any) {
    console.error("[lumey-challenges] profile:", error);

    return res.status(404).json({
      message: error?.message ?? "Profile not found.",
    });
  }
});

/**
 * PUT /api/lumey/challenges/profiles/:userID
 */
router.put("/profiles/:userID", async (req: Request, res: Response) => {
  try {
    const userID = String(req.params.userID || "").trim();

    if (!userID) {
      return res.status(400).json({
        message: "userID is required.",
      });
    }

    const profile = await updateUserProfile(userID, req.body);

    return res.status(200).json(profile);
  } catch (error: any) {
    console.error("[lumey-challenges] update profile:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to update profile.",
    });
  }
});

export default router;
