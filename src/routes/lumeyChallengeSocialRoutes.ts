import { Router, Request, Response } from "express";
import multer from "multer";
import {
  createSubmission,
  createFeedPost,
  uploadFeedPhoto,
  uploadProfileAvatar,
  approveSubmissionAndPostToFeed,
  getChallengeFeed,
  toggleFeedItemLike,
  toggleCommentLike,
  addFeedItemComment,
  deleteComment,
  deleteFeedPost,
  getUserProfile,
  updateUserProfile,
  createAnnouncement,
  getActiveAnnouncements,
  updateAnnouncementActive,
} from "../services/lumeyChallengeSocialService";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
 * POST /api/lumey/challenges/submissions/:submissionID/approve
 * Approves a challenge submission and automatically posts it to the feed.
 */
router.post(
  "/submissions/:submissionID/approve",
  async (req: Request, res: Response) => {
    try {
      const submissionID = String(req.params.submissionID || "").trim();

      if (!submissionID) {
        return res.status(400).json({
          message: "submissionID is required.",
        });
      }

      const result = await approveSubmissionAndPostToFeed({
        submissionID,
        validationMessage: req.body.validationMessage,
        challengeTitle: req.body.challengeTitle,
      });

      return res.status(200).json(result);
    } catch (error: any) {
      console.error("[lumey-challenges] approve submission:", error);

      return res.status(400).json({
        message: error?.message ?? "Unable to approve submission.",
      });
    }
  },
);

/**
 * POST /api/lumey/challenges/feed/posts
 * Creates a normal user post and adds it to the feed.
 */
router.post("/feed/posts", async (req: Request, res: Response) => {
  try {
    const feedItem = await createFeedPost(req.body);

    return res.status(201).json(feedItem);
  } catch (error: any) {
    console.error("[lumey-challenges] create feed post:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to create feed post.",
    });
  }
});

/**
 * DELETE /api/lumey/challenges/feed/posts/:postID
 * Deletes a normal user post and its feed item.
 */
router.delete("/feed/posts/:postID", async (req: Request, res: Response) => {
  try {
    const postID = String(req.params.postID || "").trim();

    if (!postID) {
      return res.status(400).json({
        message: "postID is required.",
      });
    }

    await deleteFeedPost(postID);

    return res.sendStatus(204);
  } catch (error: any) {
    console.error("[lumey-challenges] delete feed post:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to delete feed post.",
    });
  }
});

/**
 * POST /api/lumey/challenges/feed/upload-photo
 * Uploads a feed photo to Cloudinary and returns the CDN URL.
 */
router.post("/feed/upload-photo", upload.single("photo"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No photo file provided." });
    }

    const result = await uploadFeedPhoto(req.file.buffer);

    return res.status(201).json(result);
  } catch (error: any) {
    console.error("[lumey-challenges] upload feed photo:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to upload feed photo.",
    });
  }
});

/**
 * POST /api/lumey/challenges/profiles/upload-avatar
 * Uploads a profile avatar to Cloudinary and returns the CDN URL.
 */
router.post("/profiles/upload-avatar", upload.single("avatar"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No avatar file provided." });
    }

    const result = await uploadProfileAvatar(req.file.buffer);

    return res.status(201).json(result);
  } catch (error: any) {
    console.error("[lumey-challenges] upload profile avatar:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to upload profile avatar.",
    });
  }
});

/**
 * POST /api/lumey/challenges/feed/items/:feedItemID/like
 */
router.post(
  "/feed/items/:feedItemID/like",
  async (req: Request, res: Response) => {
    try {
      const feedItemID = String(req.params.feedItemID || "").trim();

      if (!feedItemID) {
        return res.status(400).json({
          message: "feedItemID is required.",
        });
      }

      const result = await toggleFeedItemLike({
        feedItemID,
        userID: req.body.userID,
      });

      return res.status(200).json(result);
    } catch (error: any) {
      console.error("[lumey-challenges] like feed item:", error);

      return res.status(400).json({
        message: error?.message ?? "Unable to update like.",
      });
    }
  },
);

/**
 * POST /api/lumey/challenges/feed/items/:feedItemID/comments
 */
router.post(
  "/feed/items/:feedItemID/comments",
  async (req: Request, res: Response) => {
    try {
      const feedItemID = String(req.params.feedItemID || "").trim();

      if (!feedItemID) {
        return res.status(400).json({
          message: "feedItemID is required.",
        });
      }

      const comment = await addFeedItemComment({
        feedItemID,
        userID: req.body.userID,
        username: req.body.username,
        avatarName: req.body.avatarName,
        avatarURL: req.body.avatarURL,
        text: req.body.text,
        parentCommentID: req.body.parentCommentID,
      });

      return res.status(201).json(comment);
    } catch (error: any) {
      console.error("[lumey-challenges] add feed item comment:", error);

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
 * POST /api/lumey/challenges/comments/:commentID/like
 */
router.post("/comments/:commentID/like", async (req: Request, res: Response) => {
  try {
    const commentID = String(req.params.commentID || "").trim();

    if (!commentID) {
      return res.status(400).json({
        message: "commentID is required.",
      });
    }

    const result = await toggleCommentLike({
      commentID,
      userID: req.body.userID,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error("[lumey-challenges] like comment:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to update comment like.",
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

/**
 * POST /api/lumey/challenges/feed/announcements
 * Body: { title, body, authorUserID, authorUsername }
 */
router.post("/feed/announcements", async (req: Request, res: Response) => {
  try {
    const announcement = await createAnnouncement(req.body);

    return res.status(201).json(announcement);
  } catch (error: any) {
    console.error("[lumey-challenges] create announcement:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to create announcement.",
    });
  }
});

/**
 * GET /api/lumey/challenges/feed/announcements
 */
router.get("/feed/announcements", async (_req: Request, res: Response) => {
  try {
    const announcements = await getActiveAnnouncements();

    return res.status(200).json(announcements);
  } catch (error: any) {
    console.error("[lumey-challenges] get announcements:", error);

    return res.status(500).json({
      message: error?.message ?? "Unable to load announcements.",
    });
  }
});

/**
 * PUT /api/lumey/challenges/feed/announcements/:announcementID
 * Body: { isActive }
 */
router.put(
  "/feed/announcements/:announcementID",
  async (req: Request, res: Response) => {
    try {
      const announcementID = String(req.params.announcementID || "").trim();

      if (!announcementID) {
        return res.status(400).json({
          message: "announcementID is required.",
        });
      }

      const announcement = await updateAnnouncementActive(
        announcementID,
        Boolean(req.body.isActive),
      );

      return res.status(200).json(announcement);
    } catch (error: any) {
      console.error("[lumey-challenges] update announcement:", error);

      return res.status(400).json({
        message: error?.message ?? "Unable to update announcement.",
      });
    }
  },
);

export default router;
