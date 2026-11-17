import { Schema, model, Document, Model, Types } from "mongoose";
import { octaviaDB } from "../config/databases";

export interface GeneratedPlaylistTrack {
  title: string;
  artist: string;
  reason: string;
  genres: string[];
  albumTitle?: string;
  albumArtUrl?: string;
  releaseDate?: string;
  label?: string;
}

export interface GeneratedPlaylistDoc extends Document {
  deviceId: string;
  playlistName: string;
  description: string;
  tracks: GeneratedPlaylistTrack[];
  createdAt: Date;
  updatedAt: Date;
}

const GeneratedPlaylistTrackSchema = new Schema(
  {
    title: { type: String, required: true },
    artist: { type: String, required: true },
    reason: { type: String, default: "" },
    genres: { type: [String], default: [] },
    albumTitle: { type: String },
    albumArtUrl: { type: String },
    releaseDate: { type: String },
    label: { type: String },
  },
  { _id: false },
);

const GeneratedPlaylistSchema = new Schema<GeneratedPlaylistDoc>(
  {
    deviceId: { type: String, required: true, index: true },
    playlistName: { type: String, required: true },
    description: { type: String, default: "" },
    tracks: { type: [GeneratedPlaylistTrackSchema], default: [] },
  },
  { timestamps: true },
);

GeneratedPlaylistSchema.index({ deviceId: 1, createdAt: -1 });

export const GeneratedPlaylist: Model<GeneratedPlaylistDoc> =
  (octaviaDB.models.GeneratedPlaylist as Model<GeneratedPlaylistDoc>) ||
  octaviaDB.model<GeneratedPlaylistDoc>(
    "GeneratedPlaylist",
    GeneratedPlaylistSchema,
  );
