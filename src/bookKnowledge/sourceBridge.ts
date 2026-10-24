import type {
  Book,
  DiscoveryProvider,
  DiscoveryPlan,
  ProviderContext,
} from "../services/loomeyRecommendations/types";

import { bookPool } from "./db";
import { ingestBook, type IngestBook } from "./repository";
import { isbn13 } from "./identity";

export async function ingestProviderBook(
  book: Book,
  depth = 0,
): Promise<string | null> {
  const minYear = Number(process.env.BOOK_KNOWLEDGE_MIN_YEAR ?? 2010);
  if (!book.title || !book.authors.length || book.language !== "eng" ||
    book.releaseYear === null || book.releaseYear < minYear || book.releaseYear > new Date().getUTCFullYear() + 1) {
    return null;
  }

  const providers = Object.entries(book.providerIDs).flatMap(
    ([provider, ids]) => (ids ?? []).map((id) => ({ provider, id })),
  );

  const first = providers[0];

  if (!first) {
    return null;
  }

  const validISBN = book.isbns
    .map(isbn13)
    .find((value): value is string => Boolean(value));

  const input: IngestBook = {
    title: book.title,
    authors: book.authors,
    description: book.description,
    language: book.language,
    genres: book.genres,
    subjects: book.subjects,
    provider: first.provider,
    providerId: first.id,
    relatedProviderIds: providers.slice(1),

    ...(book.coverUrls[0] ? { coverUrl: book.coverUrls[0] } : {}),

    ...(book.releaseYear !== null ? { year: book.releaseYear } : {}),

    ...(validISBN ? { isbn13: validISBN } : {}),

    ...(book.pages !== null ? { pages: book.pages } : {}),

    ...(book.publisher !== null ? { publisher: book.publisher } : {}),
  };

  const id = await ingestBook(input);

  await bookPool.query(
    `UPDATE bk_works
     SET tags = $2,
         author_ids = $3,
         tag_ids = $4,
         provider_ids = provider_ids || $5::jsonb,
         title_variants = $6,
         cover_urls = $7,
         source_names = $8,
         popularity = GREATEST(popularity, $9),
         expansion_depth = LEAST(expansion_depth, $10),
         last_verified_at = now(),
         refresh_after = now() + interval '30 days'
     WHERE id = $1`,
    [
      id,
      book.tags,
      book.authorIDs,
      book.tagIDs,
      JSON.stringify(book.providerIDs),
      book.titleVariants,
      book.coverUrls,
      book.sources,
      book.popularity,
      depth,
    ],
  );

  for (const source of providers) {
    await bookPool.query(
      `INSERT INTO bk_provider_ids
       (provider, provider_id, work_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [source.provider, source.id, id],
    );

    await bookPool.query(
      `INSERT INTO bk_source_observations
       (provider, provider_id, work_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, provider_id)
       DO UPDATE SET observed_at = now()`,
      [source.provider, source.id, id],
    );
  }

  for (const series of book.series) {
    if (!series.name) continue;

    const row = await bookPool.query(
      `INSERT INTO bk_series (name, normalized_name)
       VALUES ($1, lower($1))
       ON CONFLICT (normalized_name)
       DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [series.name],
    );

    await bookPool.query(
      `INSERT INTO bk_work_series
       (work_id, series_id, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (work_id, series_id)
       DO UPDATE SET position =
         COALESCE(EXCLUDED.position, bk_work_series.position)`,
      [id, row.rows[0].id, series.position],
    );
  }

  return id;
}

export async function discoverWithProviders(
  plan: DiscoveryPlan,
  providers: DiscoveryProvider[],
  context: ProviderContext,
  depth = 0,
): Promise<string[]> {
  const ids: string[] = [];

  for (const provider of providers.filter((p) => p.available())) {
    try {
      const books = await provider.discover(plan, context);

      for (const book of books) {
        const id = await ingestProviderBook(book, depth);
        if (id) ids.push(id);
      }
    } catch (error) {
      console.warn(
        "[bookKnowledge] discovery provider failed",
        provider.name,
        error instanceof Error ? error.message : "unknown",
      );
    }
  }

  return [...new Set(ids)];
}
