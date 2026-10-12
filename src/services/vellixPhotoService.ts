export class VellixPhotoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface VellixPhoto {
  id: string;
  thumbURL: string;
  imageURL: string;
  photographer: string;
  photographerURL: string;
  sourceURL: string;
}

type RawPhoto = {
  id?: string; urls?: { small?: string; regular?: string };
  links?: { html?: string; download_location?: string };
  user?: { name?: string; links?: { html?: string } };
};

function imageURL(value: unknown): string {
  if (typeof value !== "string") throw new VellixPhotoError(502, "The photo provider returned an invalid image.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "images.unsplash.com") throw new VellixPhotoError(502, "The photo provider returned an invalid image.");
  return url.toString();
}

function creditURL(value: string | undefined): string {
  const url = new URL(value || "https://unsplash.com");
  if (url.protocol !== "https:" || url.hostname !== "unsplash.com") throw new VellixPhotoError(502, "The photo provider returned invalid attribution.");
  url.searchParams.set("utm_source", "vellix");
  url.searchParams.set("utm_medium", "referral");
  return url.toString();
}

export function createVellixPhotoService(options: {
  key?: () => string | undefined; fetcher?: typeof fetch; now?: () => number;
} = {}) {
  const fetcher = options.fetcher || fetch;
  const key = options.key || (() => process.env.UNSPLASH_ACCESS_KEY);
  const now = options.now || Date.now;
  const cache = new Map<string, { expires: number; result: { photos: VellixPhoto[]; hasMore: boolean } }>();

  async function request(url: URL): Promise<unknown> {
    const accessKey = key()?.trim();
    if (!accessKey) throw new VellixPhotoError(503, "Unsplash photo search is not configured yet.");
    if (url.protocol !== "https:" || url.hostname !== "api.unsplash.com") throw new VellixPhotoError(400, "Invalid photo request.");
    try {
      const response = await fetcher(url.toString(), {
        headers: { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" },
        signal: AbortSignal.timeout(10_000), redirect: "error",
      });
      if (!response.ok) throw new VellixPhotoError(response.status === 429 ? 429 : 502,
        response.status === 429 ? "Photo search has reached its current limit. Try again later." : "Unsplash is temporarily unavailable.");
      return await response.json();
    } catch (error) {
      if (error instanceof VellixPhotoError) throw error;
      throw new VellixPhotoError(502, "Unsplash is temporarily unavailable.");
    }
  }

  return {
    async search(query: string, page = 1, shuffle = false) {
      const cleanQuery = query.trim().slice(0, 100);
      const safePage = Math.max(1, Math.min(100, Math.floor(page) || 1));
      const cacheKey = `${cleanQuery}:${safePage}`;
      const cached = cache.get(cacheKey);
      if (!shuffle && cached && cached.expires > now()) return cached.result;
      const url = new URL(cleanQuery ? "https://api.unsplash.com/search/photos" : "https://api.unsplash.com/photos/random");
      if (cleanQuery) {
        url.searchParams.set("query", cleanQuery);
        url.searchParams.set("page", String(safePage));
        url.searchParams.set("per_page", "18");
      } else { url.searchParams.set("count", "6"); }
      const raw = await request(url) as { results?: RawPhoto[]; total_pages?: number } | RawPhoto[];
      const results = Array.isArray(raw) ? raw : raw.results;
      if (!Array.isArray(results)) throw new VellixPhotoError(502, "The photo provider returned an invalid result.");
      const photos = results.slice(0, 18).map(photo => {
        if (typeof photo.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(photo.id)) throw new VellixPhotoError(502, "Invalid photo identifier.");
        return { id: photo.id, thumbURL: imageURL(photo.urls?.small), imageURL: imageURL(photo.urls?.regular),
          photographer: (photo.user?.name || "Unsplash photographer").slice(0, 120),
          photographerURL: creditURL(photo.user?.links?.html), sourceURL: creditURL(photo.links?.html) };
      });
      const result = { photos, hasMore: !Array.isArray(raw) && safePage < (raw.total_pages || 1) };
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { expires: now() + 60_000, result });
      return result;
    },
    async trackSelection(id: string) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new VellixPhotoError(400, "Invalid photo identifier.");
      const photo = await request(new URL(`https://api.unsplash.com/photos/${encodeURIComponent(id)}`)) as RawPhoto;
      let download: URL;
      try { download = new URL(photo.links?.download_location || ""); }
      catch { throw new VellixPhotoError(502, "The photo provider returned an invalid download event."); }
      if (download.hostname !== "api.unsplash.com" || download.pathname !== `/photos/${id}/download`) throw new VellixPhotoError(502, "Invalid download event.");
      await request(download);
    },
  };
}
