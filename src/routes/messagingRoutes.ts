import { Router, Request, Response } from "express";
import {
  getConversations,
  getOrCreateConversation,
  getMessages,
  sendMessage,
  markMessagesRead,
  getMessageableUsers,
} from "../services/messagingService";

const router = Router();

/**
 * GET /api/lumey/messages/conversations?userID=xxx
 */
router.get("/conversations", async (req: Request, res: Response) => {
  try {
    const userID = String(req.query.userID || "").trim();

    if (!userID) {
      return res
        .status(400)
        .json({ message: "userID query param is required." });
    }

    const conversations = await getConversations(userID);

    return res.status(200).json(conversations);
  } catch (error: any) {
    console.error("[messages] conversations:", error);

    return res.status(500).json({
      message: error?.message ?? "Unable to load conversations.",
    });
  }
});

/**
 * POST /api/lumey/messages/conversations
 * Body: { senderUserID, senderUsername, recipientUserID, recipientUsername }
 */
router.post("/conversations", async (req: Request, res: Response) => {
  try {
    const conversation = await getOrCreateConversation(req.body);

    return res.status(201).json(conversation);
  } catch (error: any) {
    console.error("[messages] create conversation:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to create conversation.",
    });
  }
});

/**
 * GET /api/lumey/messages/conversations/:conversationID/messages?userID=xxx
 */
router.get(
  "/conversations/:conversationID/messages",
  async (req: Request, res: Response) => {
    try {
      const conversationID = String(req.params.conversationID || "").trim();
      const userID = String(req.query.userID || "").trim();

      if (!conversationID || !userID) {
        return res.status(400).json({
          message: "conversationID and userID are required.",
        });
      }

      const messages = await getMessages(conversationID, userID);

      return res.status(200).json(messages);
    } catch (error: any) {
      console.error("[messages] get messages:", error);

      return res.status(400).json({
        message: error?.message ?? "Unable to load messages.",
      });
    }
  },
);

/**
 * POST /api/lumey/messages/conversations/:conversationID/messages
 * Body: { senderUserID, senderUsername, text }
 */
router.post(
  "/conversations/:conversationID/messages",
  async (req: Request, res: Response) => {
    try {
      const conversationID = String(req.params.conversationID || "").trim();

      if (!conversationID) {
        return res.status(400).json({
          message: "conversationID is required.",
        });
      }

      const message = await sendMessage({
        conversationID,
        senderUserID: req.body.senderUserID,
        senderUsername: req.body.senderUsername,
        text: req.body.text,
      });

      return res.status(201).json(message);
    } catch (error: any) {
      console.error("[messages] send message:", error);

      return res.status(400).json({
        message: error?.message ?? "Unable to send message.",
      });
    }
  },
);

/**
 * POST /api/lumey/messages/conversations/:conversationID/read
 * Body: { userID }
 */
router.post(
  "/conversations/:conversationID/read",
  async (req: Request, res: Response) => {
    try {
      const conversationID = String(req.params.conversationID || "").trim();
      const userID = String(req.body.userID || "").trim();

      if (!conversationID || !userID) {
        return res.status(400).json({
          message: "conversationID and userID are required.",
        });
      }

      const result = await markMessagesRead(conversationID, userID);

      return res.status(200).json(result);
    } catch (error: any) {
      console.error("[messages] mark read:", error);

      return res.status(400).json({
        message: error?.message ?? "Unable to mark messages as read.",
      });
    }
  },
);

/**
 * GET /api/lumey/messages/messageable-users?userID=xxx
 */
router.get("/messageable-users", async (req: Request, res: Response) => {
  try {
    const userID = String(req.query.userID || "").trim();

    if (!userID) {
      return res
        .status(400)
        .json({ message: "userID query param is required." });
    }

    const users = await getMessageableUsers(userID);

    return res.status(200).json(users);
  } catch (error: any) {
    console.error("[messages] messageable users:", error);

    return res.status(400).json({
      message: error?.message ?? "Unable to load messageable users.",
    });
  }
});

export default router;
