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
import sharedEventsRouter from "./routes/shared-events-routes";
import { createBuddyRouter } from "./routes/buddy-routes";
import { createSprintRouter } from "./routes/sprint-routes";
import userRouter from "./routes/user-routes";
import { restoreActiveSprintTimers } from "./services/sprint-service";
import wellnessWallRoutes from "./routes/wellness-wall";
import spiritualRoutes from "./routes/spiritual";
import moodRoutes from "./routes/mood";

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
  res.json({ status: "Lystaria Books API running" });
});

app.use("/api/books/summary", summaryRoute);
app.use("/api/books/recs", recsRoute);
app.use("/api/journal", journalRoutes);
app.use("/api/astrology", astrologyRoutes);
app.use("/api/shared-events", sharedEventsRouter);
app.use("/api/buddy", createBuddyRouter(io));
app.use("/api/sprint", createSprintRouter(io));
app.use("/api/user", userRouter);
app.use("/api", wellnessWallRoutes);
app.use("/api/spiritual", spiritualRoutes);
app.use("/api/mood", moodRoutes);

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

mongoose
  .connect(process.env.MONGODB_URI as string)
  .then(async () => {
    console.log("MongoDB Atlas connected");
    await restoreActiveSprintTimers(io);
    httpServer.listen(PORT, () => {
      console.log(`📚 Lystaria Books API running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });
