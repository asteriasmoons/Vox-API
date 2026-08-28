import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import summaryRoute from "./routes/summary";
import recsRoute from "./routes/recs";
import recsBookSummaryRoute from "./routes/recsBookSummary";
import recommendationCollectionsRoute from "./routes/recommendationCollections";
import recommendationBookDetailRoute from "./routes/recommendationBookDetail";
import journalRoutes from "./routes/journal";
import astrologyRoutes from "./routes/astrology";
import { createBuddyRouter } from "./routes/buddy-routes";
import { createSprintRouter } from "./routes/sprint-routes";
import userRouter from "./routes/user-routes";
import { restoreActiveSprintTimers } from "./services/sprint-service";
import spiritualRoutes from "./routes/spiritual";
import currentCorrespondencesRoutes from "./routes/currentCorrespondences";
import moodRoutes from "./routes/mood";
import checklistRoutes from "./routes/checklist";
import correspondencesRoutes from "./routes/correspondences";
import spellsRoutes from "./routes/spells";
import bookSearchRouter from "./routes/bookSearch";
import bookDetailsEnrichmentRouter from "./routes/bookDetailsEnrichment";
import groceryPriceRouter from "./routes/grocery-price";
import challengeRoutes from "./routes/challenge";
import challengeThemeRoutes from "./routes/challengeThemeRoutes";
import challengeSocialRoutes from "./routes/challengeSocialRoutes";
import readingMissionsRoutes from "./routes/readingMissions";
import readingInsightsRoutes from "./routes/readingInsights";
import messagingRoutes from "./routes/messagingRoutes";
import tinyNudgeRoutes from "./routes/tinyNudgeRoutes";
import routineTaskDetailsRoutes from "./routes/routineTaskDetailsRoutes";
import moonRouter from "./routes/moon";
import seeryRoutes from "./routes/seery.routes";
import journalInsightsRoutes from "./routes/journalInsights";
import musicLookupRoutes from "./routes/musicLookup";
import dottiRoutes from "./routes/dotti";
import { createLureliaRouter } from "./routes/lurelia";

import path from "path";
dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({ status: "Vox Apps API running" });
});

app.get("/lurelia/events/:id", (req, res) => {
  const eventBaseURL = (
    process.env.LURELIA_PUBLIC_EVENT_BASE_URL || "https://docs.voxiverse.ink/events"
  ).replace(/\/$/, "");
  const target = new URL(`${eventBaseURL}/${encodeURIComponent(String(req.params.id))}`);

  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => target.searchParams.append(key, String(entry)));
    } else if (value !== undefined) {
      target.searchParams.set(key, String(value));
    }
  }

  res.redirect(302, target.toString());
});

app.use("/api/books/summary", summaryRoute);
app.use("/api/books/recs", recsRoute);
app.use("/api/books/recs-book-summary", recsBookSummaryRoute);
app.use("/api/books/recommendation-collections", recommendationCollectionsRoute);
app.use("/api/books/recommendation-book-detail", recommendationBookDetailRoute);
app.use("/api/journal", journalRoutes);
app.use("/api/astrology", astrologyRoutes);
app.use("/api/buddy", createBuddyRouter(io));
app.use("/api/sprint", createSprintRouter(io));
app.use("/api/user", userRouter);
app.use("/api/spiritual", spiritualRoutes);
app.use("/api/spiritual/current-correspondences", currentCorrespondencesRoutes);
app.use("/api/mood", moodRoutes);
app.use("/api/checklist", checklistRoutes);
app.use("/api/correspondences", correspondencesRoutes);
app.use("/api/spells", spellsRoutes);
app.use("/api/books/search", bookSearchRouter);
app.use("/api/books/enrich-details", bookDetailsEnrichmentRouter);
app.use("/api/grocery-price", groceryPriceRouter);
app.use("/api/challenge", challengeRoutes);
app.use("/api/lumey/challenges", challengeThemeRoutes);
app.use("/api/lumey/challenges", challengeSocialRoutes);
app.use("/api/lumey/reading-missions", readingMissionsRoutes);
app.use("/api/lumey/reading-insights", readingInsightsRoutes);
app.use("/api/lumey/messages", messagingRoutes);
app.use("/api/tiny-nudge", tinyNudgeRoutes);
app.use("/api/routine-task-details", routineTaskDetailsRoutes);
app.use("/api/moon", moonRouter);
app.use("/api/seery", seeryRoutes);
app.use("/api/journal/insights", journalInsightsRoutes);
app.use("/api/music", musicLookupRoutes);
app.use("/api/dotti", dottiRoutes);
app.use("/api/lurelia", createLureliaRouter(io));

io.on("connection", (socket) => {
  socket.on("buddy:join_room", (groupId: string) => {
    socket.join(groupId);
  });

  socket.on("buddy:leave_room", (groupId: string) => {
    socket.leave(groupId);
  });

  socket.on("sprint:join_room", () => {
    socket.join("sprint:global");
  });

  socket.on("sprint:leave_room", () => {
    socket.leave("sprint:global");
  });

  // Lurelia shared events: one room per event. Clients emit
  // "event:join_room" with the sharedEventID after they open an event
  // detail view, and "event:leave_room" when they navigate away.
  socket.on("event:join_room", (sharedEventID: string) => {
    if (typeof sharedEventID === "string" && sharedEventID.length > 0) {
      socket.join(`event:${sharedEventID}`);
    }
  });

  socket.on("event:leave_room", (sharedEventID: string) => {
    if (typeof sharedEventID === "string" && sharedEventID.length > 0) {
      socket.leave(`event:${sharedEventID}`);
    }
  });

  socket.on("disconnect", () => {});
});

httpServer.listen(PORT, () => {
  console.log(`Vox Apps API running on port ${PORT}`);
});

mongoose
  .connect(process.env.MONGODB_URI as string)
  .then(async () => {
    console.log("MongoDB Atlas connected");
    await restoreActiveSprintTimers(io);
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });
