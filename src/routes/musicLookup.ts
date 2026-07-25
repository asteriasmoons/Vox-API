import { Router } from "express";
import { lookupTrackMetadata } from "../services/trackLookupService";
import { generatePlaylist, type PlaylistTrackInput } from "../services/playlistGeneratorService";
import { GeneratedPlaylist } from "../models/GeneratedPlaylist";

const router = Router();

router.post("/lookup", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const artist = String(req.body?.artist || "").trim();
    const durationSeconds = Number(req.body?.duration) || undefined;

    if (!title) {
      return res.status(400).json({ error: "Track title is required" });
    }

    const metadata = await lookupTrackMetadata(title, artist, durationSeconds);

    if (!metadata) {
      return res.status(404).json({
        error: "No metadata found",
        title,
        artist,
      });
    }

    return res.json({ track: metadata });
  } catch (error) {
    console.error("Music lookup route error:", error);

    return res.status(500).json({
      error: "Failed to look up track metadata",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/lookup/batch", async (req, res) => {
  try {
    const tracks = req.body?.tracks;

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return res.status(400).json({
        error: "Request body must include a non-empty 'tracks' array",
      });
    }

    const capped = tracks.slice(0, 20);

    const results = await Promise.all(
      capped.map(async (entry: unknown) => {
        const item = entry as { title?: string; artist?: string; duration?: number } | undefined;
        const title = String(item?.title || "").trim();
        const artist = String(item?.artist || "").trim();
        const durationSeconds = Number(item?.duration) || undefined;

        if (!title) return { title, artist, metadata: null };

        const metadata = await lookupTrackMetadata(title, artist, durationSeconds).catch(
          () => null,
        );

        return { title, artist, metadata };
      }),
    );

    return res.json({ results });
  } catch (error) {
    console.error("Music batch lookup route error:", error);

    return res.status(500).json({
      error: "Failed to look up track metadata",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/generate-playlist", async (req, res) => {
  try {
    const tracks = req.body?.tracks;
    const deviceId = String(req.body?.deviceId || "").trim();

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return res.status(400).json({
        error: "Request body must include a non-empty 'tracks' array with title, artist, and playCount",
      });
    }

    const input: PlaylistTrackInput[] = tracks
      .slice(0, 30)
      .map((entry: unknown) => {
        const item = entry as { title?: string; artist?: string; playCount?: number } | undefined;
        return {
          title: String(item?.title || "").trim(),
          artist: String(item?.artist || "").trim(),
          playCount: Number(item?.playCount) || 0,
        };
      })
      .filter((t) => t.title);

    if (input.length === 0) {
      return res.status(400).json({
        error: "No valid tracks provided",
      });
    }

    const playlist = await generatePlaylist(input);

    if (!playlist) {
      return res.status(500).json({
        error: "Failed to generate playlist recommendations",
      });
    }

    // Save to MongoDB
    const saved = await GeneratedPlaylist.create({
      deviceId,
      playlistName: playlist.playlistName,
      description: playlist.description,
      tracks: playlist.tracks,
    });

    return res.json({
      playlist: {
        _id: saved._id,
        playlistName: saved.playlistName,
        description: saved.description,
        tracks: saved.tracks,
        createdAt: saved.createdAt,
      },
    });
  } catch (error) {
    console.error("Playlist generation route error:", error);

    return res.status(500).json({
      error: "Failed to generate playlist",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

// List all generated playlists for a device
router.get("/generated-playlists/:deviceId", async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId || "").trim();

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const playlists = await GeneratedPlaylist.find({ deviceId })
      .sort({ createdAt: -1 })
      .select("playlistName description tracks createdAt")
      .lean();

    return res.json({ playlists });
  } catch (error) {
    console.error("List generated playlists error:", error);

    return res.status(500).json({
      error: "Failed to list generated playlists",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

// Delete a generated playlist
router.delete("/generated-playlists/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await GeneratedPlaylist.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Delete generated playlist error:", error);

    return res.status(500).json({
      error: "Failed to delete playlist",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
