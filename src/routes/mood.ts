import { Router, Request, Response } from "express";
import { runMoodChat, ChatMessage } from "../services/moodChatService";

const router = Router();

// POST /api/mood/chat
// Body: { messages: [{ role: "user" | "model", parts: [{ text: string }] }] }
router.post("/chat", async (req: Request, res: Response) => {
  try {
    const { messages } = req.body as { messages: ChatMessage[] };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    // Validate roles — Gemini only accepts "user" | "model"
    const valid = messages.every(
      (m) =>
        (m.role === "user" || m.role === "model") &&
        Array.isArray(m.parts) &&
        m.parts.every((p) => typeof p.text === "string"),
    );

    if (!valid) {
      res.status(400).json({
        error:
          'Each message must have role "user" or "model" and parts: [{ text: string }]',
      });
      return;
    }

    const reply = await runMoodChat(messages);
    res.json({ reply });
  } catch (err: any) {
    console.error("[mood/chat] Error:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

export default router;
