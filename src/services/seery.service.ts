/**
 * Seery's TMDB service layer.
 *
 * Required environment variable:
 *   TMDB_BEARER_TOKEN=your_tmdb_read_access_token
 *
 * Optional:
 *   TMDB_BASE_URL=https://api.themoviedb.org/3
 *   TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p
 */

export type TrendingWindow = "day" | "week";

export interface DiscoverFilters {
  page?: number;
  genreId?: number;
  networkId?: number;
  language?: string;
  sortBy?: string;
  status?:
    | "returning"
    | "planned"
    | "in_production"
    | "ended"
    | "canceled"
    | "pilot";
  firstAirDateFrom?: string;
  firstAirDateTo?: string;
}

export interface SeerySeriesSummary {
  id: number;
  name: string;
  originalName: string | null;
  overview: string;
  posterURL: string | null;
  backdropURL: string | null;
  firstAirDate: string | null;
  genreIds: number[];
  originalLanguage: string | null;
  popularity: number;
  voteAverage: number;
  voteCount: number;
  originCountries: string[];
}

export interface SeeryPagedResponse<T> {
  page: number;
  totalPages: number;
  totalResults: number;
  results: T[];
}

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

export class SeeryService {
  private readonly baseURL =
    process.env.TMDB_BASE_URL ?? "https://api.themoviedb.org/3";

  private readonly imageBaseURL =
    process.env.TMDB_IMAGE_BASE_URL ?? "https://image.tmdb.org/t/p";

  private readonly token = process.env.TMDB_BEARER_TOKEN?.trim();

  get isConfigured(): boolean {
    return Boolean(this.token);
  }

  async searchSeries(
    query: string,
    page = 1
  ): Promise<SeeryPagedResponse<SeerySeriesSummary>> {
    const payload = await this.request<TMDBPaged<TMDBSeriesSummary>>(
      "/search/tv",
      {
        query,
        page,
        include_adult: false,
      }
    );

    return this.mapPagedSeries(payload);
  }

  async getTrendingSeries(
    window: TrendingWindow = "week",
    page = 1
  ): Promise<SeeryPagedResponse<SeerySeriesSummary>> {
    const payload = await this.request<TMDBPaged<TMDBSeriesSummary>>(
      `/trending/tv/${window}`,
      { page }
    );

    return this.mapPagedSeries(payload);
  }

  async discoverSeries(
    filters: DiscoverFilters = {}
  ): Promise<SeeryPagedResponse<SeerySeriesSummary>> {
    const statusMap: Record<
      NonNullable<DiscoverFilters["status"]>,
      number
    > = {
      returning: 0,
      planned: 1,
      in_production: 2,
      ended: 3,
      canceled: 4,
      pilot: 5,
    };

    const payload = await this.request<TMDBPaged<TMDBSeriesSummary>>(
      "/discover/tv",
      {
        page: filters.page ?? 1,
        with_genres: filters.genreId,
        with_networks: filters.networkId,
        with_original_language: filters.language,
        sort_by: filters.sortBy ?? "popularity.desc",
        with_status:
          filters.status !== undefined
            ? statusMap[filters.status]
            : undefined,
        "first_air_date.gte": filters.firstAirDateFrom,
        "first_air_date.lte": filters.firstAirDateTo,
        include_null_first_air_dates: false,
      }
    );

    return this.mapPagedSeries(payload);
  }

  async getSeriesDetails(seriesId: number, region = "US"): Promise<unknown> {
    const payload = await this.request<TMDBSeriesDetails>(
      `/tv/${seriesId}`,
      {
        append_to_response: [
          "aggregate_credits",
          "content_ratings",
          "external_ids",
          "keywords",
          "recommendations",
          "similar",
          "videos",
          "watch/providers",
        ].join(","),
      }
    );

    const providers = payload["watch/providers"]?.results?.[region] ?? null;

    return {
      id: payload.id,
      name: payload.name,
      originalName: payload.original_name ?? null,
      tagline: payload.tagline ?? "",
      overview: payload.overview ?? "",
      status: payload.status ?? null,
      type: payload.type ?? null,
      inProduction: payload.in_production ?? false,
      homepage: payload.homepage || null,
      posterURL: this.imageURL(payload.poster_path, "w780"),
      backdropURL: this.imageURL(payload.backdrop_path, "original"),
      firstAirDate: payload.first_air_date || null,
      lastAirDate: payload.last_air_date || null,
      numberOfSeasons: payload.number_of_seasons ?? 0,
      numberOfEpisodes: payload.number_of_episodes ?? 0,
      episodeRunTime: payload.episode_run_time ?? [],
      genres: payload.genres ?? [],
      languages: payload.languages ?? [],
      originCountries: payload.origin_country ?? [],
      originalLanguage: payload.original_language ?? null,
      popularity: payload.popularity ?? 0,
      voteAverage: payload.vote_average ?? 0,
      voteCount: payload.vote_count ?? 0,
      networks: (payload.networks ?? []).map((network) => ({
        ...network,
        logoURL: this.imageURL(network.logo_path, "w500"),
      })),
      productionCompanies: (payload.production_companies ?? []).map(
        (company) => ({
          ...company,
          logoURL: this.imageURL(company.logo_path, "w500"),
        })
      ),
      createdBy: (payload.created_by ?? []).map((creator) => ({
        ...creator,
        profileURL: this.imageURL(creator.profile_path, "w500"),
      })),
      nextEpisodeToAir: this.mapEpisode(payload.next_episode_to_air),
      lastEpisodeToAir: this.mapEpisode(payload.last_episode_to_air),
      seasons: (payload.seasons ?? []).map((season) => ({
        id: season.id,
        name: season.name,
        overview: season.overview ?? "",
        seasonNumber: season.season_number,
        episodeCount: season.episode_count,
        airDate: season.air_date || null,
        posterURL: this.imageURL(season.poster_path, "w500"),
        voteAverage: season.vote_average ?? 0,
      })),
      cast: (payload.aggregate_credits?.cast ?? []).slice(0, 30).map(
        (person) => ({
          id: person.id,
          name: person.name,
          originalName: person.original_name ?? null,
          profileURL: this.imageURL(person.profile_path, "w500"),
          roles: person.roles ?? [],
          totalEpisodeCount: person.total_episode_count ?? 0,
          order: person.order ?? 0,
        })
      ),
      crew: (payload.aggregate_credits?.crew ?? []).slice(0, 30).map(
        (person) => ({
          id: person.id,
          name: person.name,
          profileURL: this.imageURL(person.profile_path, "w500"),
          jobs: person.jobs ?? [],
          department: person.department ?? null,
          totalEpisodeCount: person.total_episode_count ?? 0,
        })
      ),
      contentRatings: payload.content_ratings?.results ?? [],
      externalIds: payload.external_ids ?? {},
      keywords: payload.keywords?.results ?? [],
      videos: (payload.videos?.results ?? [])
        .filter((video) => video.site === "YouTube")
        .map((video) => ({
          id: video.id,
          key: video.key,
          name: video.name,
          type: video.type,
          official: video.official ?? false,
          publishedAt: video.published_at ?? null,
          youtubeURL: `https://www.youtube.com/watch?v=${video.key}`,
        })),
      recommendations: this.mapSeriesArray(
        payload.recommendations?.results ?? []
      ),
      similar: this.mapSeriesArray(payload.similar?.results ?? []),
      watchProviders: this.mapProviderRegion(providers),
    };
  }

  async getSeasonDetails(
    seriesId: number,
    seasonNumber: number
  ): Promise<unknown> {
    const payload = await this.request<TMDBSeasonDetails>(
      `/tv/${seriesId}/season/${seasonNumber}`,
      {
        append_to_response: "aggregate_credits,external_ids,videos",
      }
    );

    return {
      id: payload.id,
      name: payload.name,
      overview: payload.overview ?? "",
      seasonNumber: payload.season_number,
      airDate: payload.air_date || null,
      posterURL: this.imageURL(payload.poster_path, "w780"),
      voteAverage: payload.vote_average ?? 0,
      episodes: (payload.episodes ?? []).map((episode) =>
        this.mapEpisode(episode)
      ),
      cast: (payload.aggregate_credits?.cast ?? []).slice(0, 30).map(
        (person) => ({
          id: person.id,
          name: person.name,
          profileURL: this.imageURL(person.profile_path, "w500"),
          roles: person.roles ?? [],
          totalEpisodeCount: person.total_episode_count ?? 0,
        })
      ),
      crew: payload.aggregate_credits?.crew ?? [],
      externalIds: payload.external_ids ?? {},
      videos: payload.videos?.results ?? [],
    };
  }

  async getRecommendations(
    seriesId: number,
    page = 1
  ): Promise<SeeryPagedResponse<SeerySeriesSummary>> {
    const payload = await this.request<TMDBPaged<TMDBSeriesSummary>>(
      `/tv/${seriesId}/recommendations`,
      { page }
    );

    return this.mapPagedSeries(payload);
  }

  async getWatchProviders(
    seriesId: number,
    region = "US"
  ): Promise<unknown> {
    const payload = await this.request<{
      id: number;
      results: Record<string, TMDBProviderRegion>;
    }>(`/tv/${seriesId}/watch/providers`);

    return {
      seriesId: payload.id,
      region,
      providers: this.mapProviderRegion(payload.results?.[region] ?? null),
      availableRegions: Object.keys(payload.results ?? {}).sort(),
    };
  }

  async getUpcomingSeries(
    startDate: string,
    endDate: string,
    page = 1
  ): Promise<SeeryPagedResponse<SeerySeriesSummary>> {
    return this.discoverSeries({
      page,
      firstAirDateFrom: startDate,
      firstAirDateTo: endDate,
      sortBy: "first_air_date.asc",
    });
  }

  async getGenres(): Promise<Array<{ id: number; name: string }>> {
    const payload = await this.request<{
      genres: Array<{ id: number; name: string }>;
    }>("/genre/tv/list");

    return payload.genres ?? [];
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    if (!this.token) {
      throw new SeeryServiceError(
        503,
        "SEERY_TMDB_NOT_CONFIGURED",
        "TMDB_BEARER_TOKEN is missing from the backend environment."
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
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new SeeryServiceError(
        502,
        "SEERY_UPSTREAM_UNAVAILABLE",
        "Seery could not connect to TMDB.",
        error instanceof Error ? error.message : error
      );
    }

    const body = await this.parseResponse(response);

    if (!response.ok) {
      throw new SeeryServiceError(
        response.status,
        "SEERY_TMDB_ERROR",
        this.readTMDBError(body, response.status),
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
        "TMDB returned an invalid response."
      );
    }
  }

  private readTMDBError(body: unknown, status: number): string {
    if (
      body &&
      typeof body === "object" &&
      "status_message" in body &&
      typeof body.status_message === "string"
    ) {
      return body.status_message;
    }

    return `TMDB request failed with status ${status}.`;
  }

  private mapPagedSeries(
    payload: TMDBPaged<TMDBSeriesSummary>
  ): SeeryPagedResponse<SeerySeriesSummary> {
    return {
      page: payload.page ?? 1,
      totalPages: payload.total_pages ?? 0,
      totalResults: payload.total_results ?? 0,
      results: this.mapSeriesArray(payload.results ?? []),
    };
  }

  private mapSeriesArray(
    results: TMDBSeriesSummary[]
  ): SeerySeriesSummary[] {
    return results.map((series) => ({
      id: series.id,
      name: series.name,
      originalName: series.original_name ?? null,
      overview: series.overview ?? "",
      posterURL: this.imageURL(series.poster_path, "w500"),
      backdropURL: this.imageURL(series.backdrop_path, "w1280"),
      firstAirDate: series.first_air_date || null,
      genreIds: series.genre_ids ?? [],
      originalLanguage: series.original_language ?? null,
      popularity: series.popularity ?? 0,
      voteAverage: series.vote_average ?? 0,
      voteCount: series.vote_count ?? 0,
      originCountries: series.origin_country ?? [],
    }));
  }

  private mapEpisode(episode: TMDBEpisode | null | undefined): unknown {
    if (!episode) return null;

    return {
      id: episode.id,
      name: episode.name,
      overview: episode.overview ?? "",
      airDate: episode.air_date || null,
      episodeNumber: episode.episode_number,
      seasonNumber: episode.season_number,
      runtime: episode.runtime ?? null,
      stillURL: this.imageURL(episode.still_path, "w780"),
      voteAverage: episode.vote_average ?? 0,
      voteCount: episode.vote_count ?? 0,
      productionCode: episode.production_code || null,
      episodeType: episode.episode_type ?? null,
    };
  }

  private mapProviderRegion(region: TMDBProviderRegion | null): unknown {
    if (!region) return null;

    const mapProvider = (provider: TMDBProvider) => ({
      providerId: provider.provider_id,
      providerName: provider.provider_name,
      displayPriority: provider.display_priority ?? 0,
      logoURL: this.imageURL(provider.logo_path, "w500"),
    });

    return {
      link: region.link ?? null,
      flatrate: (region.flatrate ?? []).map(mapProvider),
      free: (region.free ?? []).map(mapProvider),
      ads: (region.ads ?? []).map(mapProvider),
      rent: (region.rent ?? []).map(mapProvider),
      buy: (region.buy ?? []).map(mapProvider),
    };
  }

  private imageURL(
    path: string | null | undefined,
    size: string
  ): string | null {
    return path ? `${this.imageBaseURL}/${size}${path}` : null;
  }
}

interface TMDBPaged<T> {
  page: number;
  total_pages: number;
  total_results: number;
  results: T[];
}

interface TMDBSeriesSummary {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  genre_ids?: number[];
  original_language?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  origin_country?: string[];
}

interface TMDBEpisode {
  id: number;
  name: string;
  overview?: string;
  air_date?: string;
  episode_number: number;
  season_number: number;
  runtime?: number | null;
  still_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  production_code?: string;
  episode_type?: string;
}

interface TMDBProvider {
  provider_id: number;
  provider_name: string;
  display_priority?: number;
  logo_path?: string | null;
}

interface TMDBProviderRegion {
  link?: string;
  flatrate?: TMDBProvider[];
  free?: TMDBProvider[];
  ads?: TMDBProvider[];
  rent?: TMDBProvider[];
  buy?: TMDBProvider[];
}

interface TMDBSeriesDetails extends TMDBSeriesSummary {
  tagline?: string;
  status?: string;
  type?: string;
  in_production?: boolean;
  homepage?: string;
  last_air_date?: string;
  number_of_seasons?: number;
  number_of_episodes?: number;
  episode_run_time?: number[];
  genres?: Array<{ id: number; name: string }>;
  languages?: string[];
  networks?: Array<{
    id: number;
    name: string;
    logo_path?: string | null;
    origin_country?: string;
  }>;
  production_companies?: Array<{
    id: number;
    name: string;
    logo_path?: string | null;
    origin_country?: string;
  }>;
  created_by?: Array<{
    id: number;
    name: string;
    gender?: number;
    credit_id?: string;
    profile_path?: string | null;
  }>;
  next_episode_to_air?: TMDBEpisode | null;
  last_episode_to_air?: TMDBEpisode | null;
  seasons?: Array<{
    id: number;
    name: string;
    overview?: string;
    season_number: number;
    episode_count: number;
    air_date?: string;
    poster_path?: string | null;
    vote_average?: number;
  }>;
  aggregate_credits?: {
    cast?: Array<Record<string, any>>;
    crew?: Array<Record<string, any>>;
  };
  content_ratings?: { results?: Array<Record<string, any>> };
  external_ids?: Record<string, unknown>;
  keywords?: { results?: Array<Record<string, any>> };
  videos?: { results?: Array<Record<string, any>> };
  recommendations?: { results?: TMDBSeriesSummary[] };
  similar?: { results?: TMDBSeriesSummary[] };
  "watch/providers"?: {
    results?: Record<string, TMDBProviderRegion>;
  };
}

interface TMDBSeasonDetails {
  id: number;
  name: string;
  overview?: string;
  season_number: number;
  air_date?: string;
  poster_path?: string | null;
  vote_average?: number;
  episodes?: TMDBEpisode[];
  aggregate_credits?: {
    cast?: Array<Record<string, any>>;
    crew?: Array<Record<string, any>>;
  };
  external_ids?: Record<string, unknown>;
  videos?: { results?: Array<Record<string, any>> };
}
