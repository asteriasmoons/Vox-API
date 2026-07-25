// src/services/playlistGeneratorService.ts

import { recommendationGroqModel } from "./groqModelConfig";
import { lookupTrackMetadata, type TrackMetadataResult } from "./trackLookupService";

const GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";

const GENERATION_TIMEOUT_MS = 30_000;
const GENERATION_RETRIES = 1;
const ENRICHMENT_CONCURRENCY = 3;
const GENERATION_MAX_TOKENS = 2048;

export type PlaylistTrackInput = {
  title: string;
  artist: string;
  playCount: number;
};

export type GeneratedTrack = {
  title: string;
  artist: string;
  reason: string;
  genres: string[];
  albumTitle?: string;
  albumArtUrl?: string;
  releaseDate?: string;
  label?: string;
};

export type GeneratedPlaylistResult = {
  playlistName: string;
  description: string;
  tracks: GeneratedTrack[];
};

type GroqPlaylistResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
};

type AIPlaylistOutput = {
  playlistName?: string;
  description?: string;
  tracks?: Array<{
    title?: string;
    artist?: string;
    reason?: string;
  }>;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithBoundedConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => runWorker(),
  );

  await Promise.all(workers);
  return results;
}

function buildPrompt(tracks: PlaylistTrackInput[]): string {
  const trackList = tracks
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 20)
    .map((t) => `- "${t.title}" by ${t.artist} (played ${t.playCount}x)`)
    .join("\n");

  return `Based on this user's most-played tracks, generate a personalized playlist recommendation of 12-15 songs they would likely enjoy but may not have heard. The recommendations should reflect the genres, moods, and styles present in their listening history while introducing variety.

User's most-played tracks:
${trackList}

Return strict JSON with this shape:
{
  "playlistName": "A creative, short playlist name that reflects the vibe",
  "description": "A 1-2 sentence description of the playlist's mood/theme",
  "tracks": [
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "reason": "One sentence explaining why this fits their taste"
    }
  ]
}

Rules:
- Only recommend REAL songs by REAL artists. Do not invent songs.
- Do not repeat any song already in the user's library.
- Mix well-known tracks with deeper cuts.
- Keep the playlist cohesive in mood but diverse in artist.
- Each reason should reference something specific about the user's taste.`;
}

function parsePlaylistResponse(raw: string): AIPlaylistOutput | null {
  const content = raw.trim();
  if (!content) return null;

  try {
    return JSON.parse(content) as AIPlaylistOutput;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]) as AIPlaylistOutput;
    } catch {
      return null;
    }
  }
}

async function generatePlaylistFromAI(
  tracks: PlaylistTrackInput[],
): Promise<AIPlaylistOutput | null> {
  const apiKey = process.env.GROQ_API_KEY || "";
  if (!apiKey) return null;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= GENERATION_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

    try {
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: recommendationGroqModel(),
          temperature: 0.7,
          max_tokens: GENERATION_MAX_TOKENS,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a music curator who creates personalized playlist recommendations. You have deep knowledge of music across all genres and eras. Return strict JSON only. Only recommend real, existing songs.",
            },
            {
              role: "user",
              content: buildPrompt(tracks),
            },
          ],
        }),
        signal: controller.signal,
      });

      const json = (await response.json().catch(() => null)) as
        | GroqPlaylistResponse
        | null;

      if (!response.ok) {
        throw new Error(
          JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            body: json,
          }),
        );
      }

      const rawContent = cleanText(json?.choices?.[0]?.message?.content);
      const parsed = parsePlaylistResponse(rawContent);

      if (parsed?.tracks && parsed.tracks.length > 0) {
        return parsed;
      }

      return null;
    } catch (error) {
      lastError = error;
      if (attempt >= GENERATION_RETRIES) break;
      await sleep(500 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error("Playlist generation failed:", lastError);
  return null;
}

function enrichTrackWithMetadata(
  aiTrack: { title?: string; artist?: string; reason?: string },
  metadata: TrackMetadataResult | null,
): GeneratedTrack {
  const result: GeneratedTrack = {
    title: cleanText(aiTrack.title),
    artist: cleanText(aiTrack.artist),
    reason: cleanText(aiTrack.reason),
    genres: metadata?.genres ?? [],
  };

  if (metadata?.albumTitle) result.albumTitle = metadata.albumTitle;
  if (metadata?.albumArtUrl) result.albumArtUrl = metadata.albumArtUrl;
  if (metadata?.releaseDate) result.releaseDate = metadata.releaseDate;
  if (metadata?.label) result.label = metadata.label;

  return result;
}

export async function generatePlaylist(
  userTracks: PlaylistTrackInput[],
): Promise<GeneratedPlaylistResult | null> {
  if (userTracks.length === 0) return null;

  const aiResult = await generatePlaylistFromAI(userTracks);
  if (!aiResult?.tracks || aiResult.tracks.length === 0) return null;

  // Enrich each recommended track with MusicBrainz/Discogs metadata
  const enrichedTracks = await mapWithBoundedConcurrency(
    aiResult.tracks,
    ENRICHMENT_CONCURRENCY,
    async (aiTrack) => {
      const title = cleanText(aiTrack.title);
      const artist = cleanText(aiTrack.artist);

      if (!title) return enrichTrackWithMetadata(aiTrack, null);

      const metadata = await lookupTrackMetadata(title, artist).catch(
        () => null,
      );

      return enrichTrackWithMetadata(aiTrack, metadata);
    },
  );

  const validTracks = enrichedTracks.filter((t) => t.title && t.artist);

  return {
    playlistName: cleanText(aiResult.playlistName) || "Your Curated Mix",
    description:
      cleanText(aiResult.description) ||
      "A playlist tailored to your listening habits.",
    tracks: validTracks,
  };
}
