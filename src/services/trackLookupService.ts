// src/services/trackLookupService.ts

const MUSICBRAINZ_API = "https://musicbrainz.org/ws/2";
const DISCOGS_API = "https://api.discogs.com";
const ITUNES_API = "https://itunes.apple.com/search";
const USER_AGENT = "OctaviaApp/1.0 (asteriasmoons@outlook.com)";

const LOOKUP_TIMEOUT_MS = 12_000;

export type TrackMetadataResult = {
  title: string;
  artist: string;
  albumTitle?: string;
  genres: string[];
  releaseDate?: string;
  albumArtUrl?: string;
  artistBio?: string;
  similarArtists: string[];
  label?: string;
  duration?: number;
  source: string;
};

export type TrackMetadataCandidate = TrackMetadataResult & {
  matchScore: number;
};

type MusicBrainzRecording = {
  id?: string;
  title?: string;
  "artist-credit"?: Array<{
    name?: string;
    artist?: {
      id?: string;
      name?: string;
      disambiguation?: string;
    };
  }>;
  releases?: Array<{
    id?: string;
    title?: string;
    date?: string;
    "release-group"?: {
      id?: string;
      "primary-type"?: string;
    };
    "label-info"?: Array<{
      label?: {
        name?: string;
      };
    }>;
  }>;
  tags?: Array<{
    name?: string;
    count?: number;
  }>;
  length?: number;
};

type MusicBrainzSearchResponse = {
  recordings?: MusicBrainzRecording[];
};

type MusicBrainzArtistResponse = {
  id?: string;
  name?: string;
  disambiguation?: string;
  "life-span"?: {
    begin?: string;
    end?: string;
    ended?: boolean;
  };
  area?: {
    name?: string;
  };
  tags?: Array<{
    name?: string;
    count?: number;
  }>;
  relations?: Array<{
    type?: string;
    url?: {
      resource?: string;
    };
  }>;
};

type DiscogsSearchResult = {
  id?: number;
  title?: string;
  year?: string;
  genre?: string[];
  style?: string[];
  label?: string[];
  cover_image?: string;
  thumb?: string;
  master_id?: number;
};

type DiscogsSearchResponse = {
  results?: DiscogsSearchResult[];
};

type DiscogsArtistResponse = {
  id?: number;
  name?: string;
  profile?: string;
  images?: Array<{
    uri?: string;
    type?: string;
  }>;
  members?: Array<{
    name?: string;
    active?: boolean;
  }>;
};

type DiscogsMasterResponse = {
  id?: number;
  title?: string;
  year?: number;
  genres?: string[];
  styles?: string[];
  images?: Array<{
    uri?: string;
    type?: string;
  }>;
  artists?: Array<{
    name?: string;
    id?: number;
  }>;
};

type ITunesTrack = {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
};

type ITunesSearchResponse = {
  results?: ITunesTrack[];
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanArtistForLookup(value: unknown): string {
  const artist = cleanText(value);
  const normalized = artist.toLowerCase();
  if (!artist || normalized === "unknown" || normalized === "unknown artist") {
    return "";
  }
  return artist;
}

function normalizedForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(ft|feat|featuring)\b/g, "feat")
    .trim();
}

function valuesCompatible(requested: string, candidate: string): boolean {
  if (!requested || !candidate) return false;
  return (
    candidate === requested ||
    candidate.includes(requested) ||
    requested.includes(candidate)
  );
}

function durationScore(
  candidateSeconds: number | undefined,
  requestedSeconds: number | undefined,
): number {
  if (!candidateSeconds || !requestedSeconds) return 0;

  const difference = Math.abs(candidateSeconds - requestedSeconds);
  if (difference <= 3) return 6;
  if (difference <= 8) return 4;
  if (difference <= 15) return 2;
  if (difference > 30) return -8;
  return 0;
}

function hasUsableDuration(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseArtistTitle(
  value: string,
): { artist: string; title: string } | null {
  const separators = [" - ", " – ", " — "];

  for (const separator of separators) {
    const parts = value.split(separator);
    if (parts.length < 2) continue;

    const artist = cleanText(parts[0]);
    const title = cleanText(parts.slice(1).join(separator));

    if (artist && title) return { artist, title };
  }

  return null;
}

function metadataFromITunesTrack(
  track: ITunesTrack,
  fallbackTitle: string,
  fallbackArtist: string,
): TrackMetadataResult {
  const result: TrackMetadataResult = {
    title: cleanText(track.trackName) || fallbackTitle,
    artist: cleanText(track.artistName) || fallbackArtist,
    genres: [],
    similarArtists: [],
    source: "iTunes",
  };

  const genre = cleanText(track.primaryGenreName);
  const albumTitle = cleanText(track.collectionName);
  const releaseDate = cleanText(track.releaseDate);
  const artworkUrl = cleanText(track.artworkUrl100);

  if (genre) result.genres = [genre];
  if (albumTitle) result.albumTitle = albumTitle;
  if (releaseDate) result.releaseDate = releaseDate.slice(0, 10);
  if (artworkUrl) {
    result.albumArtUrl = artworkUrl.replace(
      /100x100bb\.(jpg|jpeg|png)$/i,
      "600x600bb.$1",
    );
  }
  if (track.trackTimeMillis) {
    result.duration = Math.round(track.trackTimeMillis / 1000);
  }

  return result;
}

async function fetchWithTimeout<T>(
  url: string | URL,
  headers: Record<string, string>,
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── MusicBrainz ──

async function searchMusicBrainz(
  title: string,
  artist: string,
  durationSeconds?: number,
): Promise<TrackMetadataResult | null> {
  const query = artist
    ? `recording:"${title}" AND artist:"${artist}"`
    : `recording:"${title}"`;
  const url = new URL(`${MUSICBRAINZ_API}/recording`);
  url.searchParams.set("query", query);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("inc", "releases+tags+artist-credits");

  const data = await fetchWithTimeout<MusicBrainzSearchResponse>(
    url.toString(),
    {},
  );

  const recordings = data?.recordings ?? [];
  if (recordings.length === 0) return null;

  const requestedTitle = normalizedForMatch(title);
  const requestedArtist = normalizedForMatch(artist);
  const scored = recordings
    .map((recording) => {
      const recordingTitle = normalizedForMatch(cleanText(recording.title));
      const recordingArtist = normalizedForMatch(
        cleanText(recording["artist-credit"]?.[0]?.artist?.name),
      );
      const recordingDuration = recording.length
        ? Math.round(recording.length / 1000)
        : undefined;
      let score = 0;

      if (recordingTitle === requestedTitle) score += 10;
      if (valuesCompatible(requestedTitle, recordingTitle)) score += 3;
      if (requestedArtist && recordingArtist === requestedArtist) score += 8;
      if (
        requestedArtist &&
        valuesCompatible(requestedArtist, recordingArtist)
      ) {
        score += 3;
      }
      score += durationScore(recordingDuration, durationSeconds);

      return { recording, score };
    })
    .sort((a, b) => b.score - a.score);

  const bestScore = scored[0]?.score ?? 0;
  const best = scored[0]?.recording;
  if (!best) return null;

  const artistCredit = best["artist-credit"]?.[0];
  const recordingTitle = normalizedForMatch(cleanText(best.title));
  const recordingArtist = normalizedForMatch(
    cleanText(artistCredit?.artist?.name),
  );

  if (!valuesCompatible(requestedTitle, recordingTitle)) return null;
  if (requestedArtist && !valuesCompatible(requestedArtist, recordingArtist)) {
    return null;
  }
  if (
    !requestedArtist &&
    hasUsableDuration(durationSeconds) &&
    bestScore < 14
  ) {
    return null;
  }
  if (!requestedArtist && !hasUsableDuration(durationSeconds)) {
    return null;
  }

  const release = best.releases?.[0];
  const tags = (best.tags ?? [])
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 8)
    .map((t) => cleanText(t.name))
    .filter(Boolean);

  const labelInfo = release?.["label-info"]?.[0];

  const result: TrackMetadataResult = {
    title: cleanText(best.title) || title,
    artist: cleanText(artistCredit?.artist?.name) || artist,
    genres: tags,
    similarArtists: [],
    source: "MusicBrainz",
  };

  if (release?.title) result.albumTitle = cleanText(release.title);
  if (release?.date) result.releaseDate = release.date;
  if (labelInfo?.label?.name) result.label = cleanText(labelInfo.label.name);
  if (best.length) result.duration = Math.round(best.length / 1000);

  // Fetch cover art from Cover Art Archive
  if (release?.id) {
    const coverUrl = `https://coverartarchive.org/release/${release.id}/front-250`;
    result.albumArtUrl = coverUrl;
  }

  // Fetch artist details for bio + similar artists
  const artistId = artistCredit?.artist?.id;
  if (artistId) {
    const artistData = await fetchMusicBrainzArtist(artistId);
    if (artistData) {
      if (artistData.bio) result.artistBio = artistData.bio;
      if (artistData.similarArtists.length > 0) {
        result.similarArtists = artistData.similarArtists;
      }
      if (tags.length === 0 && artistData.genres.length > 0) {
        result.genres = artistData.genres;
      }
    }
  }

  return result;
}

async function fetchMusicBrainzArtist(
  artistId: string,
): Promise<{ bio: string; similarArtists: string[]; genres: string[] } | null> {
  const url = `${MUSICBRAINZ_API}/artist/${artistId}?fmt=json&inc=tags+url-rels`;
  const data = await fetchWithTimeout<MusicBrainzArtistResponse>(url, {});
  if (!data) return null;

  const tags = (data.tags ?? [])
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 6)
    .map((t) => cleanText(t.name))
    .filter(Boolean);

  const area = cleanText(data.area?.name);
  const lifeSpan = data["life-span"];
  const bioParts: string[] = [];

  if (area) bioParts.push(`From ${area}`);
  if (lifeSpan?.begin) {
    const active = lifeSpan.ended
      ? `Active ${lifeSpan.begin}–${lifeSpan.end ?? "unknown"}`
      : `Active since ${lifeSpan.begin}`;
    bioParts.push(active);
  }
  if (data.disambiguation) bioParts.push(data.disambiguation);

  return {
    bio: bioParts.join(". ") || "",
    similarArtists: [],
    genres: tags,
  };
}

// ── Discogs ──

async function searchDiscogs(
  title: string,
  artist: string,
): Promise<TrackMetadataResult | null> {
  const token = process.env.DISCOGS_TOKEN || "";
  if (!token) return null;
  if (!artist) return null;

  const url = new URL(`${DISCOGS_API}/database/search`);
  url.searchParams.set("track", title);
  url.searchParams.set("artist", artist);
  url.searchParams.set("type", "master");
  url.searchParams.set("per_page", "5");

  const data = await fetchWithTimeout<DiscogsSearchResponse>(url.toString(), {
    Authorization: `Discogs token=${token}`,
  });

  const results = data?.results ?? [];
  if (results.length === 0) return null;

  const best = results[0];
  if (!best) return null;

  const genres = [...(best.genre ?? []), ...(best.style ?? [])]
    .map((g) => cleanText(g))
    .filter(Boolean)
    .slice(0, 8);

  const result: TrackMetadataResult = {
    title,
    artist,
    genres,
    similarArtists: [],
    source: "Discogs",
  };

  const albumParts = cleanText(best.title).split(" - ");
  if (albumParts.length >= 2) {
    result.albumTitle = albumParts.slice(1).join(" - ").trim();
  }

  if (best.year) result.releaseDate = best.year;
  if (best.label?.[0]) result.label = cleanText(best.label[0]);

  const coverImage = best.cover_image || best.thumb;
  if (coverImage && !coverImage.includes("spacer.gif")) {
    result.albumArtUrl = coverImage;
  }

  // Fetch master release for better genre/style data and art
  if (best.master_id) {
    const masterData = await fetchDiscogsMaster(best.master_id, token);
    if (masterData) {
      if (masterData.genres.length > genres.length) {
        result.genres = masterData.genres;
      }
      if (masterData.albumArtUrl) result.albumArtUrl = masterData.albumArtUrl;
      if (masterData.year) result.releaseDate = String(masterData.year);
    }
  }

  // Fetch artist profile for bio
  const artistSearchUrl = new URL(`${DISCOGS_API}/database/search`);
  artistSearchUrl.searchParams.set("q", artist);
  artistSearchUrl.searchParams.set("type", "artist");
  artistSearchUrl.searchParams.set("per_page", "1");

  const artistSearch = await fetchWithTimeout<DiscogsSearchResponse>(
    artistSearchUrl.toString(),
    { Authorization: `Discogs token=${token}` },
  );

  const artistResult = artistSearch?.results?.[0];
  if (artistResult?.id) {
    const artistData = await fetchDiscogsArtist(artistResult.id, token);
    if (artistData?.profile) {
      result.artistBio = artistData.profile;
    }
  }

  return result;
}

async function fetchDiscogsMaster(
  masterId: number,
  token: string,
): Promise<{
  genres: string[];
  albumArtUrl?: string;
  year?: number;
} | null> {
  const url = `${DISCOGS_API}/masters/${masterId}`;
  const data = await fetchWithTimeout<DiscogsMasterResponse>(url, {
    Authorization: `Discogs token=${token}`,
  });
  if (!data) return null;

  const genres = [...(data.genres ?? []), ...(data.styles ?? [])]
    .map((g) => cleanText(g))
    .filter(Boolean)
    .slice(0, 8);

  const primaryImage = data.images?.find((img) => img.type === "primary");
  const albumArtUrl = primaryImage?.uri ?? data.images?.[0]?.uri;

  const result: { genres: string[]; albumArtUrl?: string; year?: number } = {
    genres,
  };

  if (albumArtUrl) result.albumArtUrl = albumArtUrl;
  if (data.year != null) result.year = data.year;

  return result;
}

async function fetchDiscogsArtist(
  artistId: number,
  token: string,
): Promise<{ profile?: string } | null> {
  const url = `${DISCOGS_API}/artists/${artistId}`;
  const data = await fetchWithTimeout<DiscogsArtistResponse>(url, {
    Authorization: `Discogs token=${token}`,
  });
  if (!data) return null;

  let profile = cleanText(data.profile);
  // Discogs profiles have [a=Artist Name] markup — strip it
  profile = profile
    .replace(/\[a=([^\]]+)\]/g, "$1")
    .replace(/\[([^\]]+)\]/g, "$1");

  if (profile) return { profile };
  return {};
}

// ── iTunes Search ──

async function searchITunes(
  title: string,
  artist: string,
  durationSeconds?: number,
): Promise<TrackMetadataResult | null> {
  const term = artist ? `${artist} ${title}` : title;
  const url = new URL(ITUNES_API);
  url.searchParams.set("term", term);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "10");

  const data = await fetchWithTimeout<ITunesSearchResponse>(url.toString(), {});
  const results = data?.results ?? [];
  if (results.length === 0) return null;

  const requestedTitle = normalizedForMatch(title);
  const requestedArtist = normalizedForMatch(artist);

  const scored = results
    .map((track) => {
      const trackTitle = normalizedForMatch(cleanText(track.trackName));
      const trackArtist = normalizedForMatch(cleanText(track.artistName));
      const trackDuration = track.trackTimeMillis
        ? Math.round(track.trackTimeMillis / 1000)
        : undefined;
      let score = 0;

      if (trackTitle === requestedTitle) score += 10;
      if (valuesCompatible(requestedTitle, trackTitle)) score += 3;
      if (requestedArtist && trackArtist === requestedArtist) score += 8;
      if (requestedArtist && valuesCompatible(requestedArtist, trackArtist)) {
        score += 3;
      }
      score += durationScore(trackDuration, durationSeconds);
      if (track.primaryGenreName) score += 1;
      if (track.artworkUrl100) score += 1;

      return { track, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.track;
  if (!best) return null;

  const bestScore = scored[0]?.score ?? 0;
  const bestTitle = normalizedForMatch(cleanText(best.trackName));
  const bestArtist = normalizedForMatch(cleanText(best.artistName));

  if (!valuesCompatible(requestedTitle, bestTitle)) return null;
  if (requestedArtist && !valuesCompatible(requestedArtist, bestArtist)) {
    return null;
  }
  if (
    !requestedArtist &&
    hasUsableDuration(durationSeconds) &&
    bestScore < 17
  ) {
    return null;
  }
  if (!requestedArtist && !hasUsableDuration(durationSeconds)) {
    return null;
  }

  return metadataFromITunesTrack(best, title, artist);
}

async function searchITunesCandidates(
  term: string,
  requestedTitle: string,
  requestedArtist: string,
  durationSeconds?: number,
  limit = 40,
): Promise<TrackMetadataCandidate[]> {
  const url = new URL(ITUNES_API);
  url.searchParams.set("term", term);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "200");

  const data = await fetchWithTimeout<ITunesSearchResponse>(url.toString(), {});
  const results = data?.results ?? [];
  if (results.length === 0) return [];

  const normalizedTerm = normalizedForMatch(term);
  const queryTokens = normalizedTerm
    .split(" ")
    .filter((token) => token.length > 1);
  const normalizedRequestedTitle = normalizedForMatch(requestedTitle);
  const normalizedRequestedArtist = normalizedForMatch(requestedArtist);

  return results
    .map((track) => {
      const trackTitle = normalizedForMatch(cleanText(track.trackName));
      const trackArtist = normalizedForMatch(cleanText(track.artistName));
      const trackAlbum = normalizedForMatch(cleanText(track.collectionName));
      const combined = `${trackArtist} ${trackTitle} ${trackAlbum}`;
      const trackDuration = track.trackTimeMillis
        ? Math.round(track.trackTimeMillis / 1000)
        : undefined;
      let score = 0;

      if (trackTitle === normalizedRequestedTitle) score += 10;
      if (valuesCompatible(normalizedRequestedTitle, trackTitle)) score += 4;
      if (
        normalizedRequestedArtist &&
        trackArtist === normalizedRequestedArtist
      ) {
        score += 10;
      }
      if (
        normalizedRequestedArtist &&
        valuesCompatible(normalizedRequestedArtist, trackArtist)
      ) {
        score += 4;
      }
      score += durationScore(trackDuration, durationSeconds);
      score += queryTokens.filter((token) => combined.includes(token)).length;
      if (track.primaryGenreName) score += 1;
      if (track.artworkUrl100) score += 1;

      return {
        ...metadataFromITunesTrack(
          track,
          requestedTitle || term,
          requestedArtist,
        ),
        matchScore: score,
      };
    })
    .filter((candidate) => candidate.title && candidate.artist)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

export async function searchTrackMetadataCandidates(
  query: string,
  title: string,
  artist: string,
  durationSeconds?: number,
): Promise<TrackMetadataCandidate[]> {
  let cleanTitle = cleanText(title);
  let cleanArtist = cleanArtistForLookup(artist);
  const cleanQuery = cleanText(query);
  const term =
    cleanQuery || [cleanArtist, cleanTitle].filter(Boolean).join(" ");

  if (!term) return [];

  if (!cleanArtist) {
    const parsed = parseArtistTitle(cleanQuery || cleanTitle);
    if (parsed) {
      cleanTitle = parsed.title;
      cleanArtist = parsed.artist;
    }
  }

  const cleanDuration = hasUsableDuration(durationSeconds)
    ? durationSeconds
    : undefined;

  return searchITunesCandidates(
    term,
    cleanTitle || cleanQuery,
    cleanArtist,
    cleanDuration,
  );
}

// ── Public API ──

export async function lookupTrackMetadata(
  title: string,
  artist: string,
  durationSeconds?: number,
): Promise<TrackMetadataResult | null> {
  let cleanTitle = cleanText(title);
  let cleanArtist = cleanArtistForLookup(artist);
  if (!cleanTitle) return null;

  if (!cleanArtist) {
    const parsed = parseArtistTitle(cleanTitle);
    if (parsed) {
      cleanTitle = parsed.title;
      cleanArtist = parsed.artist;
    }
  }

  if (!cleanArtist) return null;

  const cleanDuration = hasUsableDuration(durationSeconds)
    ? durationSeconds
    : undefined;

  const itunesResult = await searchITunes(
    cleanTitle,
    cleanArtist,
    cleanDuration,
  ).catch(() => null);

  // Try MusicBrainz first
  const mbResult = await searchMusicBrainz(
    cleanTitle,
    cleanArtist,
    cleanDuration,
  );
  if (mbResult && mbResult.genres.length > 0) {
    // If MusicBrainz returned genres, try Discogs for supplementary data
    const discogsResult = await searchDiscogs(cleanTitle, cleanArtist).catch(
      () => null,
    );
    if (discogsResult) {
      const merged = mergeResults(mbResult, discogsResult);
      return itunesResult ? mergeResults(itunesResult, merged) : merged;
    }
    return itunesResult ? mergeResults(itunesResult, mbResult) : mbResult;
  }

  // MusicBrainz failed or had no genres — try Discogs as primary
  const discogsResult = await searchDiscogs(cleanTitle, cleanArtist);
  if (discogsResult) {
    const merged = mbResult
      ? mergeResults(mbResult, discogsResult)
      : discogsResult;
    if (itunesResult) return mergeResults(itunesResult, merged);
    return merged;
  }

  if (itunesResult) {
    if (mbResult) {
      return mergeResults(itunesResult, mbResult);
    }
    return itunesResult;
  }

  // Return whatever MusicBrainz had even without genres
  return mbResult;
}

function mergeResults(
  primary: TrackMetadataResult,
  secondary: TrackMetadataResult,
): TrackMetadataResult {
  const mergedGenres = Array.from(
    new Set([...primary.genres, ...secondary.genres]),
  ).slice(0, 10);

  const mergedSimilar = Array.from(
    new Set([...primary.similarArtists, ...secondary.similarArtists]),
  ).slice(0, 8);

  const result: TrackMetadataResult = {
    title: primary.title || secondary.title,
    artist: primary.artist || secondary.artist,
    genres: mergedGenres,
    similarArtists: mergedSimilar,
    source: [primary.source, secondary.source]
      .filter((source, index, sources) => sources.indexOf(source) === index)
      .join(" + "),
  };

  const albumTitle = primary.albumTitle || secondary.albumTitle;
  const releaseDate = primary.releaseDate || secondary.releaseDate;
  const albumArtUrl = primary.albumArtUrl || secondary.albumArtUrl;
  const artistBio = primary.artistBio || secondary.artistBio;
  const label = primary.label || secondary.label;
  const duration = primary.duration || secondary.duration;

  if (albumTitle) result.albumTitle = albumTitle;
  if (releaseDate) result.releaseDate = releaseDate;
  if (albumArtUrl) result.albumArtUrl = albumArtUrl;
  if (artistBio) result.artistBio = artistBio;
  if (label) result.label = label;
  if (duration) result.duration = duration;

  return result;
}
