/**
 * Seery's dual-provider service layer.
 *
 * Primary: TVmaze REST API — search, details, seasons, episodes, cast, crew, schedule, images.
 * Secondary: TMDB API — trending, discover, genres, recommendations, watch providers, videos.
 *
 * ID mapping between providers uses shared IMDb / TheTVDB IDs.
 */

// ─── Public Types (shared across providers) ─────────────────────

export interface SeerySeriesSummary {
  id: number;
  name: string;
  overview: string;
  posterURL: string | null;
  backdropURL: string | null;
  firstAirDate: string | null;
  genres: string[];
  language: string | null;
  type: string | null;
  status: string | null;
  rating: number | null;
  runtime: number | null;
  averageRuntime: number | null;
  network: SeeryNetwork | null;
  webChannel: SeeryWebChannel | null;
}

export interface SeeryPagedResponse<T> {
  page: number;
  totalPages: number;
  totalResults: number;
  results: T[];
}

export interface SeeryNetwork {
  id: number;
  name: string;
  country: SeeryCountry | null;
  officialSite: string | null;
}

export interface SeeryWebChannel {
  id: number;
  name: string;
  officialSite: string | null;
}

export interface SeeryCountry {
  name: string;
  code: string;
  timezone: string;
}

export interface SeeryCastMember {
  person: {
    id: number;
    name: string;
    birthday: string | null;
    gender: string | null;
    country: SeeryCountry | null;
    imageURL: string | null;
  };
  character: {
    id: number;
    name: string;
    imageURL: string | null;
  };
  self: boolean;
  voice: boolean;
}

export interface SeeryCrewMember {
  person: {
    id: number;
    name: string;
    imageURL: string | null;
  };
  type: string;
}

export interface SeerySeasonSummary {
  id: number;
  number: number;
  name: string;
  premiereDate: string | null;
  endDate: string | null;
  episodeOrder: number | null;
  network: SeeryNetwork | null;
  webChannel: SeeryWebChannel | null;
  imageURL: string | null;
}

export interface SeeryEpisodeDetails {
  id: number;
  name: string;
  overview: string;
  airDate: string | null;
  airTime: string | null;
  airStamp: string | null;
  episodeNumber: number;
  seasonNumber: number;
  runtime: number | null;
  type: string | null;
  rating: number | null;
  stillURL: string | null;
}

export interface SeeryShowImage {
  id: number;
  type: string | null;
  main: boolean;
  resolutions: {
    original: string | null;
    medium: string | null;
  };
}

export interface SeeryScheduleItem {
  episodeId: number;
  episodeName: string;
  seasonNumber: number;
  episodeNumber: number;
  airDate: string | null;
  airTime: string | null;
  airStamp: string | null;
  runtime: number | null;
  overview: string;
  stillURL: string | null;
  show: SeerySeriesSummary;
}

// ─── TMDB-specific public types ─────────────────────────────────

export interface SeeryTMDBSeriesSummary {
  id: number;
  name: string;
  overview: string;
  posterURL: string | null;
  backdropURL: string | null;
  firstAirDate: string | null;
  genreIds: number[];
  voteAverage: number;
  voteCount: number;
  popularity: number;
}

export interface SeeryGenre {
  id: number;
  name: string;
}

export interface SeeryRecommendation {
  id: number;
  name: string;
  overview: string;
  posterURL: string | null;
  backdropURL: string | null;
  firstAirDate: string | null;
  voteAverage: number;
  genreIds: number[];
}

export interface SeeryWatchProvider {
  providerId: number;
  providerName: string;
  logoURL: string | null;
  displayPriority: number;
}

export interface SeeryWatchProviderResult {
  link: string | null;
  flatrate: SeeryWatchProvider[];
  rent: SeeryWatchProvider[];
  buy: SeeryWatchProvider[];
  ads: SeeryWatchProvider[];
  free: SeeryWatchProvider[];
}

export interface SeeryVideo {
  id: string;
  name: string;
  key: string;
  site: string;
  type: string;
  official: boolean;
  publishedAt: string | null;
}

export interface SeeryReview {
  id: string;
  author: string;
  authorUsername: string | null;
  authorAvatarURL: string | null;
  authorRating: number | null;
  content: string;
  createdAt: string;
  url: string | null;
}

export interface SeeryIDMapping {
  tvMazeID: number | null;
  tmdbID: number | null;
  imdbID: string | null;
  thetvdbID: number | null;
}

// ─── Error ───────────────────────────────────────────────────────

export class SeeryServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "SeeryServiceError";
  }
}

// ═══════════════════════════════════════════════════════════════════
// TVmaze Service (primary)
// ═══════════════════════════════════════════════════════════════════

export class SeeryService {
  private readonly baseURL = "https://api.tvmaze.com";

  get isConfigured(): boolean {
    return true; // TVmaze public API requires no key
  }

  // ── Search ───────────────────────────────────────────────────

  async searchSeries(query: string): Promise<SeeryPagedResponse<SeerySeriesSummary>> {
    const payload = await this.request<TVMazeSearchResult[]>(
      "/search/shows",
      { q: query }
    );

    const results = payload.map((item) => this.mapShow(item.show));

    return {
      page: 1,
      totalPages: 1,
      totalResults: results.length,
      results,
    };
  }

  // ── Schedule ────────────────────────────────────────────────

  async getSchedule(
    date?: string,
    country = "US"
  ): Promise<SeeryScheduleItem[]> {
    const params: Record<string, string> = { country };
    if (date) params.date = date;

    const payload = await this.request<TVMazeScheduleEntry[]>(
      "/schedule",
      params
    );

    return payload.map((entry) => this.mapScheduleEntry(entry));
  }

  async getWebSchedule(date?: string): Promise<SeeryScheduleItem[]> {
    const params: Record<string, string> = {};
    if (date) params.date = date;

    const payload = await this.request<TVMazeWebScheduleEntry[]>(
      "/schedule/web",
      params
    );

    return payload.map((entry) => this.mapWebScheduleEntry(entry));
  }

  // ── Show Details ─────────────────────────────────────────────

  async getSeriesDetails(showId: number): Promise<unknown> {
    const payload = await this.request<TVMazeShow>(`/shows/${showId}`);

    const [castData, seasonData, crewData, imageData] = await Promise.all([
      this.request<TVMazeCastEntry[]>(`/shows/${showId}/cast`),
      this.request<TVMazeSeason[]>(`/shows/${showId}/seasons`),
      this.request<TVMazeCrewEntry[]>(`/shows/${showId}/crew`),
      this.request<TVMazeImage[]>(`/shows/${showId}/images`).catch(
        () => [] as TVMazeImage[]
      ),
    ]);

    const totalEpisodes = seasonData.reduce(
      (sum, s) => sum + (s.episodeOrder ?? 0),
      0
    );

    // Extract external IDs for cross-provider mapping
    const externals = {
      imdb: payload.externals?.imdb ?? null,
      thetvdb: payload.externals?.thetvdb ?? null,
      tvrage: payload.externals?.tvrage ?? null,
    };

    return {
      id: payload.id,
      name: payload.name,
      overview: stripHTML(payload.summary),
      type: payload.type ?? null,
      language: payload.language ?? null,
      genres: payload.genres ?? [],
      status: payload.status ?? null,
      runtime: payload.runtime ?? null,
      averageRuntime: payload.averageRuntime ?? null,
      premiered: payload.premiered ?? null,
      ended: payload.ended ?? null,
      officialSite: payload.officialSite ?? null,
      schedule: payload.schedule ?? null,
      rating: payload.rating?.average ?? null,
      weight: payload.weight ?? 0,
      posterURL: payload.image?.original ?? null,
      backdropURL: payload.image?.original ?? null,
      network: this.mapNetwork(payload.network),
      webChannel: this.mapWebChannel(payload.webChannel),
      externals,
      numberOfSeasons: seasonData.filter(
        (s) => s.number !== null && s.number > 0
      ).length,
      numberOfEpisodes: totalEpisodes,
      seasons: seasonData
        .filter((s) => s.number !== null && s.number > 0)
        .map((s) => this.mapSeason(s)),
      cast: castData.slice(0, 30).map((entry) => this.mapCast(entry)),
      crew: this.deduplicateCrew(crewData)
        .slice(0, 20)
        .map((entry) => this.mapCrew(entry)),
      images: imageData.map((img) => this.mapImage(img)),
      previousEpisode: payload._links?.previousepisode
        ? {
            href: payload._links.previousepisode.href,
            name: payload._links.previousepisode.name ?? null,
          }
        : null,
      nextEpisode: payload._links?.nextepisode
        ? {
            href: payload._links.nextepisode.href,
            name: payload._links.nextepisode.name ?? null,
          }
        : null,
      tvMazeURL: payload.url ?? null,
    };
  }

  // ── Season Episodes ──────────────────────────────────────────

  async getSeasonEpisodes(
    showId: number,
    seasonNumber: number
  ): Promise<unknown> {
    const seasons = await this.request<TVMazeSeason[]>(
      `/shows/${showId}/seasons`
    );

    const season = seasons.find((s) => s.number === seasonNumber);
    if (!season) {
      throw new SeeryServiceError(
        404,
        "SEERY_SEASON_NOT_FOUND",
        `Season ${seasonNumber} not found for show ${showId}.`
      );
    }

    const episodes = await this.request<TVMazeEpisode[]>(
      `/seasons/${season.id}/episodes`
    );

    return {
      id: season.id,
      name: season.name || `Season ${season.number}`,
      overview: stripHTML(season.summary),
      seasonNumber: season.number,
      premiereDate: season.premiereDate ?? null,
      endDate: season.endDate ?? null,
      episodeOrder: season.episodeOrder ?? null,
      imageURL: season.image?.original ?? null,
      episodes: episodes.map((ep) => this.mapEpisode(ep)),
    };
  }

  // ── Show Cast ────────────────────────────────────────────────

  async getShowCast(showId: number): Promise<SeeryCastMember[]> {
    const payload = await this.request<TVMazeCastEntry[]>(
      `/shows/${showId}/cast`
    );
    return payload.map((entry) => this.mapCast(entry));
  }

  // ── Show Images ──────────────────────────────────────────────

  async getShowImages(showId: number): Promise<SeeryShowImage[]> {
    const payload = await this.request<TVMazeImage[]>(
      `/shows/${showId}/images`
    );
    return payload.map((img) => this.mapImage(img));
  }

  // ── TVmaze Lookup by External ID ─────────────────────────────

  async lookupByImdb(imdbId: string): Promise<TVMazeShow | null> {
    try {
      return await this.request<TVMazeShow>(`/lookup/shows`, {
        imdb: imdbId,
      });
    } catch {
      return null;
    }
  }

  async lookupByThetvdb(thetvdbId: number): Promise<TVMazeShow | null> {
    try {
      return await this.request<TVMazeShow>(`/lookup/shows`, {
        thetvdb: thetvdbId,
      });
    } catch {
      return null;
    }
  }

  // ── Get external IDs for a show ──────────────────────────────

  async getExternals(
    showId: number
  ): Promise<{ imdb: string | null; thetvdb: number | null }> {
    const show = await this.request<TVMazeShow>(`/shows/${showId}`);
    return {
      imdb: show.externals?.imdb ?? null,
      thetvdb: show.externals?.thetvdb ?? null,
    };
  }

  // ── HTTP Client ──────────────────────────────────────────────

  private async request<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    const url = new URL(`${this.baseURL}${path}`);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        if (key === "embed[]") {
          const embeds = String(value).split(",");
          for (const embed of embeds) {
            url.searchParams.append("embed[]", embed.trim());
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Seery/1.0 (TV Tracker App)",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new SeeryServiceError(
        502,
        "SEERY_UPSTREAM_UNAVAILABLE",
        "Seery could not connect to TVmaze.",
        error instanceof Error ? error.message : error
      );
    }

    if (response.status === 404) {
      throw new SeeryServiceError(
        404,
        "SEERY_NOT_FOUND",
        "The requested resource was not found on TVmaze."
      );
    }

    if (response.status === 429) {
      throw new SeeryServiceError(
        429,
        "SEERY_RATE_LIMITED",
        "TVmaze rate limit exceeded. Please try again shortly."
      );
    }

    const body = await this.parseResponse(response);

    if (!response.ok) {
      throw new SeeryServiceError(
        response.status,
        "SEERY_TVMAZE_ERROR",
        `TVmaze request failed with status ${response.status}.`,
        body
      );
    }

    return body as T;
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      throw new SeeryServiceError(
        502,
        "SEERY_INVALID_UPSTREAM_RESPONSE",
        "TVmaze returned an invalid response."
      );
    }
  }

  // ── Mappers ──────────────────────────────────────────────────

  private mapShow(show: TVMazeShow): SeerySeriesSummary {
    return {
      id: show.id,
      name: show.name,
      overview: stripHTML(show.summary),
      posterURL: show.image?.original ?? null,
      backdropURL: show.image?.original ?? null,
      firstAirDate: show.premiered ?? null,
      genres: show.genres ?? [],
      language: show.language ?? null,
      type: show.type ?? null,
      status: show.status ?? null,
      rating: show.rating?.average ?? null,
      runtime: show.runtime ?? null,
      averageRuntime: show.averageRuntime ?? null,
      network: this.mapNetwork(show.network),
      webChannel: this.mapWebChannel(show.webChannel),
    };
  }

  private mapNetwork(
    network: TVMazeNetwork | null | undefined
  ): SeeryNetwork | null {
    if (!network) return null;
    return {
      id: network.id,
      name: network.name,
      country: network.country ?? null,
      officialSite: network.officialSite ?? null,
    };
  }

  private mapWebChannel(
    channel: TVMazeWebChannel | null | undefined
  ): SeeryWebChannel | null {
    if (!channel) return null;
    return {
      id: channel.id,
      name: channel.name,
      officialSite: channel.officialSite ?? null,
    };
  }

  private mapSeason(season: TVMazeSeason): SeerySeasonSummary {
    return {
      id: season.id,
      number: season.number ?? 0,
      name: season.name || `Season ${season.number}`,
      premiereDate: season.premiereDate ?? null,
      endDate: season.endDate ?? null,
      episodeOrder: season.episodeOrder ?? null,
      network: this.mapNetwork(season.network),
      webChannel: this.mapWebChannel(season.webChannel),
      imageURL: season.image?.original ?? null,
    };
  }

  private mapEpisode(episode: TVMazeEpisode): SeeryEpisodeDetails {
    return {
      id: episode.id,
      name: episode.name,
      overview: stripHTML(episode.summary),
      airDate: episode.airdate ?? null,
      airTime: episode.airtime ?? null,
      airStamp: episode.airstamp ?? null,
      episodeNumber: episode.number ?? 0,
      seasonNumber: episode.season ?? 0,
      runtime: episode.runtime ?? null,
      type: episode.type ?? null,
      rating: episode.rating?.average ?? null,
      stillURL: episode.image?.original ?? null,
    };
  }

  private mapCast(entry: TVMazeCastEntry): SeeryCastMember {
    return {
      person: {
        id: entry.person.id,
        name: entry.person.name,
        birthday: entry.person.birthday ?? null,
        gender: entry.person.gender ?? null,
        country: entry.person.country ?? null,
        imageURL: entry.person.image?.medium ?? null,
      },
      character: {
        id: entry.character.id,
        name: entry.character.name,
        imageURL: entry.character.image?.medium ?? null,
      },
      self: entry.self ?? false,
      voice: entry.voice ?? false,
    };
  }

  private mapCrew(entry: TVMazeCrewEntry): SeeryCrewMember {
    return {
      person: {
        id: entry.person.id,
        name: entry.person.name,
        imageURL: entry.person.image?.medium ?? null,
      },
      type: entry.type,
    };
  }

  private mapImage(img: TVMazeImage): SeeryShowImage {
    return {
      id: img.id,
      type: img.type ?? null,
      main: img.main ?? false,
      resolutions: {
        original: img.resolutions?.original?.url ?? null,
        medium: img.resolutions?.medium?.url ?? null,
      },
    };
  }

  private mapScheduleEntry(entry: TVMazeScheduleEntry): SeeryScheduleItem {
    return {
      episodeId: entry.id,
      episodeName: entry.name,
      seasonNumber: entry.season ?? 0,
      episodeNumber: entry.number ?? 0,
      airDate: entry.airdate ?? null,
      airTime: entry.airtime ?? null,
      airStamp: entry.airstamp ?? null,
      runtime: entry.runtime ?? null,
      overview: stripHTML(entry.summary),
      stillURL: entry.image?.original ?? null,
      show: this.mapShow(entry.show),
    };
  }

  private mapWebScheduleEntry(
    entry: TVMazeWebScheduleEntry
  ): SeeryScheduleItem {
    return {
      episodeId: entry.id,
      episodeName: entry.name,
      seasonNumber: entry.season ?? 0,
      episodeNumber: entry.number ?? 0,
      airDate: entry.airdate ?? null,
      airTime: entry.airtime ?? null,
      airStamp: entry.airstamp ?? null,
      runtime: entry.runtime ?? null,
      overview: stripHTML(entry.summary),
      stillURL: entry.image?.original ?? null,
      show: this.mapShow(entry._embedded?.show ?? ({} as TVMazeShow)),
    };
  }

  /**
   * Deduplicates crew by exact person+role combo.
   * Preserves multiple legitimate roles for the same person.
   */
  private deduplicateCrew(crew: TVMazeCrewEntry[]): TVMazeCrewEntry[] {
    const seen = new Set<string>();
    return crew.filter((entry) => {
      const key = `${entry.person.id}-${entry.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// TMDB Service (secondary — trending, discover, genres, recs, etc.)
// ═══════════════════════════════════════════════════════════════════

export class SeeryTMDBService {
  private readonly baseURL = "https://api.themoviedb.org/3";
  private readonly imageBase = "https://image.tmdb.org/t/p/";
  private readonly bearerToken: string | undefined;

  constructor() {
    this.bearerToken = process.env.TMDB_BEARER_TOKEN;
  }

  get isConfigured(): boolean {
    return !!this.bearerToken;
  }

  // ── Trending ─────────────────────────────────────────────────

  async trending(
    timeWindow: "day" | "week" = "day",
    page = 1
  ): Promise<SeeryPagedResponse<SeeryTMDBSeriesSummary>> {
    const data = await this.request<TMDBPagedResponse>(
      `/trending/tv/${timeWindow}`,
      { page }
    );

    return {
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((r: TMDBTVResult) => this.mapTMDBSeries(r)),
    };
  }

  // ── Airing Today ─────────────────────────────────────────────

  async airingToday(
    page = 1
  ): Promise<SeeryPagedResponse<SeeryTMDBSeriesSummary>> {
    const data = await this.request<TMDBPagedResponse>("/tv/airing_today", {
      page,
    });

    return {
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((r: TMDBTVResult) => this.mapTMDBSeries(r)),
    };
  }

  // ── Discover ─────────────────────────────────────────────────

  async discover(filters: {
    page?: number;
    sortBy?: string;
    withGenres?: string;
    firstAirDateGte?: string;
    firstAirDateLte?: string;
    voteAverageGte?: number;
    withStatus?: string;
  }): Promise<SeeryPagedResponse<SeeryTMDBSeriesSummary>> {
    const params: Record<string, string | number> = {
      page: filters.page ?? 1,
      sort_by: filters.sortBy ?? "popularity.desc",
    };

    if (filters.withGenres) params.with_genres = filters.withGenres;
    if (filters.firstAirDateGte)
      params["first_air_date.gte"] = filters.firstAirDateGte;
    if (filters.firstAirDateLte)
      params["first_air_date.lte"] = filters.firstAirDateLte;
    if (filters.voteAverageGte !== undefined)
      params["vote_average.gte"] = filters.voteAverageGte;
    if (filters.withStatus) params.with_status = filters.withStatus;

    const data = await this.request<TMDBPagedResponse>("/discover/tv", params);

    return {
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((r: TMDBTVResult) => this.mapTMDBSeries(r)),
    };
  }

  // ── Genres ───────────────────────────────────────────────────

  async genres(language = "en"): Promise<SeeryGenre[]> {
    const data = await this.request<{ genres: TMDBGenre[] }>(
      "/genre/tv/list",
      { language }
    );
    return data.genres.map((g) => ({ id: g.id, name: g.name }));
  }

  // ── Recommendations ─────────────────────────────────────────

  async recommendations(
    tmdbId: number,
    page = 1
  ): Promise<SeeryPagedResponse<SeeryRecommendation>> {
    const data = await this.request<TMDBPagedResponse>(
      `/tv/${tmdbId}/recommendations`,
      { page }
    );

    return {
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((r: TMDBTVResult) => ({
        id: r.id,
        name: r.name ?? r.original_name ?? "",
        overview: r.overview ?? "",
        posterURL: r.poster_path
          ? `${this.imageBase}w500${r.poster_path}`
          : null,
        backdropURL: r.backdrop_path
          ? `${this.imageBase}w780${r.backdrop_path}`
          : null,
        firstAirDate: r.first_air_date ?? null,
        voteAverage: r.vote_average ?? 0,
        genreIds: r.genre_ids ?? [],
      })),
    };
  }

  // ── Watch Providers ─────────────────────────────────────────

  async watchProviders(
    tmdbId: number,
    region = "US"
  ): Promise<SeeryWatchProviderResult> {
    const data = await this.request<{
      results: Record<string, TMDBProviderRegion>;
    }>(`/tv/${tmdbId}/watch/providers`);

    const regionData = data.results?.[region];
    if (!regionData) {
      return {
        link: null,
        flatrate: [],
        rent: [],
        buy: [],
        ads: [],
        free: [],
      };
    }

    const mapProviders = (
      list: TMDBProvider[] | undefined
    ): SeeryWatchProvider[] =>
      (list ?? []).map((p) => ({
        providerId: p.provider_id,
        providerName: p.provider_name,
        logoURL: p.logo_path
          ? `${this.imageBase}w92${p.logo_path}`
          : null,
        displayPriority: p.display_priority ?? 999,
      }));

    return {
      link: regionData.link ?? null,
      flatrate: mapProviders(regionData.flatrate),
      rent: mapProviders(regionData.rent),
      buy: mapProviders(regionData.buy),
      ads: mapProviders(regionData.ads),
      free: mapProviders(regionData.free),
    };
  }

  // ── Videos ──────────────────────────────────────────────────

  async videos(tmdbId: number): Promise<SeeryVideo[]> {
    const data = await this.request<{ results: TMDBVideo[] }>(
      `/tv/${tmdbId}/videos`
    );

    return data.results.map((v) => ({
      id: v.id,
      name: v.name,
      key: v.key,
      site: v.site,
      type: v.type,
      official: v.official ?? false,
      publishedAt: v.published_at ?? null,
    }));
  }

  // ── Reviews ─────────────────────────────────────────────────

  async reviews(
    tmdbId: number,
    page = 1
  ): Promise<SeeryPagedResponse<SeeryReview>> {
    const data = await this.request<{
      page: number;
      total_pages: number;
      total_results: number;
      results: TMDBReview[];
    }>(`/tv/${tmdbId}/reviews`, { page });

    return {
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((r) => ({
        id: r.id,
        author: r.author,
        authorUsername: r.author_details?.username ?? null,
        authorAvatarURL: r.author_details?.avatar_path
          ? r.author_details.avatar_path.startsWith("/http")
            ? r.author_details.avatar_path.slice(1)
            : `${this.imageBase}w185${r.author_details.avatar_path}`
          : null,
        authorRating: r.author_details?.rating ?? null,
        content: r.content,
        createdAt: r.created_at,
        url: r.url ?? null,
      })),
    };
  }

  // ── Find by External ID (for ID mapping) ────────────────────

  async findByImdbId(
    imdbId: string
  ): Promise<{ tvResults: TMDBTVResult[] }> {
    const data = await this.request<{ tv_results: TMDBTVResult[] }>(
      `/find/${imdbId}`,
      { external_source: "imdb_id" }
    );
    return { tvResults: data.tv_results ?? [] };
  }

  async findByTvdbId(
    tvdbId: number
  ): Promise<{ tvResults: TMDBTVResult[] }> {
    const data = await this.request<{ tv_results: TMDBTVResult[] }>(
      `/find/${tvdbId}`,
      { external_source: "tvdb_id" }
    );
    return { tvResults: data.tv_results ?? [] };
  }

  // ── TMDB External IDs for a show ────────────────────────────

  async externalIds(
    tmdbId: number
  ): Promise<{ imdb_id: string | null; tvdb_id: number | null }> {
    const data = await this.request<{
      imdb_id?: string | null;
      tvdb_id?: number | null;
    }>(`/tv/${tmdbId}/external_ids`);
    return {
      imdb_id: data.imdb_id ?? null,
      tvdb_id: data.tvdb_id ?? null,
    };
  }

  // ── HTTP Client ──────────────────────────────────────────────

  private async request<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    if (!this.bearerToken) {
      throw new SeeryServiceError(
        503,
        "SEERY_TMDB_NOT_CONFIGURED",
        "TMDB bearer token is not configured."
      );
    }

    const url = new URL(`${this.baseURL}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.bearerToken}`,
          "User-Agent": "Seery/1.0 (TV Tracker App)",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new SeeryServiceError(
        502,
        "SEERY_TMDB_UNAVAILABLE",
        "Seery could not connect to TMDB.",
        error instanceof Error ? error.message : error
      );
    }

    if (response.status === 404) {
      throw new SeeryServiceError(
        404,
        "SEERY_TMDB_NOT_FOUND",
        "The requested resource was not found on TMDB."
      );
    }

    if (response.status === 429) {
      throw new SeeryServiceError(
        429,
        "SEERY_TMDB_RATE_LIMITED",
        "TMDB rate limit exceeded. Please try again shortly."
      );
    }

    const text = await response.text();
    if (!text) return {} as T;

    try {
      const body = JSON.parse(text);
      if (!response.ok) {
        throw new SeeryServiceError(
          response.status,
          "SEERY_TMDB_ERROR",
          body.status_message ?? `TMDB request failed (${response.status}).`,
          body
        );
      }
      return body as T;
    } catch (e) {
      if (e instanceof SeeryServiceError) throw e;
      throw new SeeryServiceError(
        502,
        "SEERY_TMDB_INVALID_RESPONSE",
        "TMDB returned an invalid response."
      );
    }
  }

  // ── Mapper ──────────────────────────────────────────────────

  private mapTMDBSeries(r: TMDBTVResult): SeeryTMDBSeriesSummary {
    return {
      id: r.id,
      name: r.name ?? r.original_name ?? "",
      overview: r.overview ?? "",
      posterURL: r.poster_path
        ? `${this.imageBase}w500${r.poster_path}`
        : null,
      backdropURL: r.backdrop_path
        ? `${this.imageBase}w780${r.backdrop_path}`
        : null,
      firstAirDate: r.first_air_date ?? null,
      genreIds: r.genre_ids ?? [],
      voteAverage: r.vote_average ?? 0,
      voteCount: r.vote_count ?? 0,
      popularity: r.popularity ?? 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// ID Mapper — bridges TVmaze ↔ TMDB via shared IMDb / TheTVDB IDs
// ═══════════════════════════════════════════════════════════════════

export class SeeryIDMapper {
  constructor(
    private tvmaze: SeeryService,
    private tmdb: SeeryTMDBService
  ) {}

  /**
   * Given a TVmaze show ID, resolve the corresponding TMDB ID.
   */
  async tmdbIdFromTVmaze(tvMazeId: number): Promise<number | null> {
    try {
      const externals = await this.tvmaze.getExternals(tvMazeId);

      // Try IMDb ID first
      if (externals.imdb) {
        const result = await this.tmdb.findByImdbId(externals.imdb);
        const first = result.tvResults[0];
        if (first) return first.id;
      }

      // Fallback to TheTVDB ID
      if (externals.thetvdb) {
        const result = await this.tmdb.findByTvdbId(externals.thetvdb);
        const first = result.tvResults[0];
        if (first) return first.id;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Given a TMDB show ID, resolve the corresponding TVmaze ID.
   */
  async tvMazeIdFromTMDB(tmdbId: number): Promise<number | null> {
    try {
      const externals = await this.tmdb.externalIds(tmdbId);

      // Try IMDb ID first
      if (externals.imdb_id) {
        const show = await this.tvmaze.lookupByImdb(externals.imdb_id);
        if (show) return show.id;
      }

      // Fallback to TheTVDB ID
      if (externals.tvdb_id) {
        const show = await this.tvmaze.lookupByThetvdb(externals.tvdb_id);
        if (show) return show.id;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve full ID mapping for a TVmaze show.
   */
  async resolveFromTVmaze(tvMazeId: number): Promise<SeeryIDMapping> {
    const externals = await this.tvmaze.getExternals(tvMazeId);
    const tmdbId = await this.tmdbIdFromTVmaze(tvMazeId);

    return {
      tvMazeID: tvMazeId,
      tmdbID: tmdbId,
      imdbID: externals.imdb,
      thetvdbID: externals.thetvdb,
    };
  }

  /**
   * Resolve full ID mapping for a TMDB show.
   */
  async resolveFromTMDB(tmdbId: number): Promise<SeeryIDMapping> {
    const externals = await this.tmdb.externalIds(tmdbId);
    const tvMazeId = await this.tvMazeIdFromTMDB(tmdbId);

    return {
      tvMazeID: tvMazeId,
      tmdbID: tmdbId,
      imdbID: externals.imdb_id,
      thetvdbID: externals.tvdb_id,
    };
  }
}

// ─── Shared Utilities ───────────────────────────────────────────

function stripHTML(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// ─── TVmaze Raw Types ───────────────────────────────────────────

interface TVMazeSearchResult {
  score: number;
  show: TVMazeShow;
}

interface TVMazeShow {
  id: number;
  url?: string;
  name: string;
  type?: string;
  language?: string;
  genres?: string[];
  status?: string;
  runtime?: number | null;
  averageRuntime?: number | null;
  premiered?: string | null;
  ended?: string | null;
  officialSite?: string | null;
  schedule?: { time?: string; days?: string[] };
  rating?: { average?: number | null };
  weight?: number;
  network?: TVMazeNetwork | null;
  webChannel?: TVMazeWebChannel | null;
  externals?: {
    tvrage?: number | null;
    thetvdb?: number | null;
    imdb?: string | null;
  };
  image?: TVMazeImageRef | null;
  summary?: string | null;
  updated?: number;
  _links?: {
    self?: { href: string };
    previousepisode?: { href: string; name?: string };
    nextepisode?: { href: string; name?: string };
  };
  _embedded?: {
    cast?: TVMazeCastEntry[];
    seasons?: TVMazeSeason[];
    crew?: TVMazeCrewEntry[];
  };
}

interface TVMazeNetwork {
  id: number;
  name: string;
  country?: SeeryCountry | null;
  officialSite?: string | null;
}

interface TVMazeWebChannel {
  id: number;
  name: string;
  country?: SeeryCountry | null;
  officialSite?: string | null;
}

interface TVMazeImageRef {
  medium?: string | null;
  original?: string | null;
}

interface TVMazeSeason {
  id: number;
  url?: string;
  number: number | null;
  name?: string;
  episodeOrder?: number | null;
  premiereDate?: string | null;
  endDate?: string | null;
  network?: TVMazeNetwork | null;
  webChannel?: TVMazeWebChannel | null;
  image?: TVMazeImageRef | null;
  summary?: string | null;
}

interface TVMazeEpisode {
  id: number;
  url?: string;
  name: string;
  season?: number;
  number?: number;
  type?: string;
  airdate?: string;
  airtime?: string;
  airstamp?: string;
  runtime?: number | null;
  rating?: { average?: number | null };
  image?: TVMazeImageRef | null;
  summary?: string | null;
  _links?: {
    self?: { href: string };
    show?: { href: string; name?: string };
  };
}

interface TVMazeCastEntry {
  person: {
    id: number;
    name: string;
    birthday?: string | null;
    deathday?: string | null;
    gender?: string | null;
    country?: SeeryCountry | null;
    image?: TVMazeImageRef | null;
  };
  character: {
    id: number;
    name: string;
    image?: TVMazeImageRef | null;
  };
  self?: boolean;
  voice?: boolean;
}

interface TVMazeCrewEntry {
  type: string;
  person: {
    id: number;
    name: string;
    image?: TVMazeImageRef | null;
  };
}

interface TVMazeImage {
  id: number;
  type?: string | null;
  main?: boolean;
  resolutions?: {
    original?: { url?: string };
    medium?: { url?: string };
  };
}

interface TVMazeScheduleEntry extends TVMazeEpisode {
  show: TVMazeShow;
}

interface TVMazeWebScheduleEntry extends TVMazeEpisode {
  _embedded?: {
    show?: TVMazeShow;
  };
}

// ─── TMDB Raw Types ─────────────────────────────────────────────

interface TMDBPagedResponse {
  page: number;
  total_pages: number;
  total_results: number;
  results: TMDBTVResult[];
}

interface TMDBTVResult {
  id: number;
  name?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string | null;
  genre_ids?: number[];
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  origin_country?: string[];
}

interface TMDBGenre {
  id: number;
  name: string;
}

interface TMDBProviderRegion {
  link?: string;
  flatrate?: TMDBProvider[];
  rent?: TMDBProvider[];
  buy?: TMDBProvider[];
  ads?: TMDBProvider[];
  free?: TMDBProvider[];
}

interface TMDBProvider {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
  display_priority?: number;
}

interface TMDBVideo {
  id: string;
  name: string;
  key: string;
  site: string;
  size: number;
  type: string;
  official?: boolean;
  published_at?: string;
}

interface TMDBReview {
  id: string;
  author: string;
  author_details?: {
    name?: string;
    username?: string;
    avatar_path?: string | null;
    rating?: number | null;
  };
  content: string;
  created_at: string;
  url?: string;
}
