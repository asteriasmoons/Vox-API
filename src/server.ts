import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import summaryRoute from "./routes/summary";
import recsRoute from "./routes/recs";
import journalRoutes from "./routes/journal";
import astrologyRoutes from "./routes/astrology";
import { createBuddyRouter } from "./routes/buddy-routes";
import { createSprintRouter } from "./routes/sprint-routes";
import userRouter from "./routes/user-routes";
import { restoreActiveSprintTimers } from "./services/sprint-service";
import spiritualRoutes from "./routes/spiritual";
import moodRoutes from "./routes/mood";
import checklistRoutes from "./routes/checklist";
import bookSearchRouter from "./routes/bookSearch";
import groceryPriceRouter from "./routes/grocery-price";
import challengeRoutes from "./routes/challenge";
import challengeThemeRoutes from "./routes/challengeThemeRoutes";
import challengeSocialRoutes from "./routes/challengeSocialRoutes";
import messagingRoutes from "./routes/messagingRoutes";
import tinyNudgeRoutes from "./routes/tinyNudgeRoutes";
import moonRouter from "./routes/moon";
import seeryRoutes from "./routes/seery.routes";

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
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ status: "Vox Apps API running" });
});

app.use("/api/books/summary", summaryRoute);
app.use("/api/books/recs", recsRoute);
app.use("/api/journal", journalRoutes);
app.use("/api/astrology", astrologyRoutes);
app.use("/api/buddy", createBuddyRouter(io));
app.use("/api/sprint", createSprintRouter(io));
app.use("/api/user", userRouter);
app.use("/api/spiritual", spiritualRoutes);
app.use("/api/mood", moodRoutes);
app.use("/api/checklist", checklistRoutes);
app.use("/api/books/search", bookSearchRouter);
app.use("/api/grocery-price", groceryPriceRouter);
app.use("/api/challenge", challengeRoutes);
app.use("/api/lumey/challenges", challengeThemeRoutes);
app.use("/api/lumey/challenges", challengeSocialRoutes);
app.use("/api/lumey/messages", messagingRoutes);
app.use("/api/tiny-nudge", tinyNudgeRoutes);
app.use("/api/moon", moonRouter);
app.use("/api/seery", seeryRoutes);

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