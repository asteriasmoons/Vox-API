import type { Pool, PoolClient, QueryConfig } from 'pg';
import { bookPool } from './db';
import { authorKeys, cleanText, coverURL, distinct, emptyBook, isbn, list, normalized, text, title } from '../services/loomeyRecommendations/normalization';
import type { Book, ProviderName, ReadingPreferences } from '../services/loomeyRecommendations/types';
import { readingCategoryTerms } from '../services/loomeyRecommendations/readingPreferences';

export type KnowledgeBookSearch = {
  terms?: string[]; authors?: string[]; titles?: string[]; isbns?: string[];
  seriesNames?: string[]; workIDs?: string[]; relatedTo?: string[];
  providerIDs?: { provider: string; id: string }[];
  category?: ReadingPreferences['preferredCategory']; limit?: number;
};

const workID = (value: string): string | null => {
  const raw = value.replace(/^pg_/, '').replace(/-/g, '');
  return /^[a-f0-9]{32}$/i.test(raw) ? raw.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5') : null;
};

export function knowledgeBook(row: any): Book | null {
  if (!text(row?.id) || !workID(row.id) || !title(row.title) || !['eng', 'en'].includes(row.language)) return null;
  const authors = distinct(list(row.authors).map(cleanText));
  if (!authors.length) return null;
  const id = 'pg_' + row.id.replace(/-/g, '');
  const ids: Book['providerIDs'] = {};
  for (const provider of ['hardcover', 'google-books', 'open-library'] as const) {
    const values = distinct([...list(row.provider_ids?.[provider]), ...(Array.isArray(row.identifiers) ? row.identifiers.filter((entry: any) => entry?.provider === provider).map((entry: any) => text(entry.id)) : [])]);
    if (values.length) ids[provider] = values;
  }
  const sources = distinct([...list(row.source_names), ...Object.keys(ids)]).filter(value => ['hardcover', 'google-books', 'open-library'].includes(value)) as ProviderName[];
  const covers = distinct([...list(row.cover_urls), ...list(row.edition_covers), text(row.cover_url)].map(coverURL).filter((value): value is string => !!value));
  const series = (Array.isArray(row.series) ? row.series : []).flatMap((item: any) => {
    const name = cleanText(item?.name);
    const position = item?.position == null ? null : Number(item.position);
    return name ? [{ id: `pg_series_${text(item.id).replace(/-/g, '')}`, name, position: position !== null && Number.isFinite(position) ? position : null }] : [];
  });
  return { ...emptyBook('open-library', id), id, knowledgeWorkIDs: [id], title: title(row.title), subtitle: cleanText(row.metadata?.subtitle) || null,
    authors, description: cleanText(row.description), isbns: distinct(list(row.isbns).map(value => isbn(value) ?? '')), providerIDs: ids,
    titleVariants: distinct([title(row.title), ...list(row.title_variants).map(title)]), genres: list(row.genres).map(cleanText), subjects: list(row.subjects).map(cleanText),
    tags: list(row.tags).map(cleanText), authorIDs: list(row.author_ids), tagIDs: list(row.tag_ids), series, relatedIDs: list(row.related),
    coverUrls: covers, language: 'eng', pages: Number.isInteger(row.pages) && row.pages > 0 ? row.pages : null,
    publisher: cleanText(row.publisher) || null, releaseYear: Number.isInteger(row.first_published_year) ? row.first_published_year : null,
    popularity: Number.isFinite(Number(row.popularity)) ? Math.max(0, Number(row.popularity)) : 0, sources };
}

export async function queryKnowledgeBooks(search: KnowledgeBookSearch, pool: Pick<Pool, 'connect'> = bookPool): Promise<Book[]> {
  const values: unknown[] = [];
  const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const selectors: string[] = [];
  const terms = distinct((search.terms ?? []).map(normalized).filter(Boolean)).slice(0, 8);
  const termParameter = parameter(terms);
  const termMatch = `EXISTS(SELECT 1 FROM bk_work_subjects ws JOIN bk_subjects s ON s.id=ws.subject_id WHERE ws.work_id=w.id AND (' '||s.normalized_label||' ') LIKE '% '||t||' %')
    OR EXISTS(SELECT 1 FROM unnest(w.tags) tag WHERE (' '||lower(regexp_replace(tag,'[^[:alnum:]]+',' ','g'))||' ') LIKE '% '||t||' %')`;
  if (terms.length) selectors.push(`EXISTS(SELECT 1 FROM unnest(${termParameter}::text[]) t WHERE (' '||w.normalized_title||' ') LIKE '% '||t||' %' OR ${termMatch})`);
  const add = (items: string[] | undefined, normalize: (value: string) => string | null, predicate: (p: string) => string) => {
    const normalizedItems = distinct((items ?? []).map(value => normalize(value) ?? '')).slice(0, 32);
    if (normalizedItems.length) selectors.push(predicate(parameter(normalizedItems)));
  };
  add(search.authors ? [...search.authors, ...search.authors.flatMap(authorKeys)] : undefined, normalized, p => `EXISTS(SELECT 1 FROM bk_work_authors wa JOIN bk_authors a ON a.id=wa.author_id WHERE wa.work_id=w.id AND a.normalized_name=ANY(${p}::text[]))`);
  add(search.titles, normalized, p => `(w.normalized_title=ANY(${p}::text[]) OR EXISTS(SELECT 1 FROM unnest(w.title_variants) v WHERE lower(regexp_replace(v,'[^[:alnum:]]+',' ','g'))=ANY(${p}::text[])))`);
  add(search.isbns, isbn, p => `EXISTS(SELECT 1 FROM bk_editions e WHERE e.work_id=w.id AND e.isbn13=ANY(${p}::text[]))`);
  add(search.seriesNames, normalized, p => `EXISTS(SELECT 1 FROM bk_work_series ws JOIN bk_series s ON s.id=ws.series_id WHERE ws.work_id=w.id AND trim(regexp_replace(s.normalized_name,'[^[:alnum:]]+',' ','g'))=ANY(${p}::text[]))`);
  add(search.workIDs, workID, p => `w.id=ANY(${p}::uuid[])`);
  add(search.relatedTo, workID, p => `EXISTS(SELECT 1 FROM bk_related r WHERE (r.from_work=ANY(${p}::uuid[]) AND r.to_work=w.id) OR (r.to_work=ANY(${p}::uuid[]) AND r.from_work=w.id))`);
  for (const item of (search.providerIDs ?? []).slice(0, 24)) selectors.push(`EXISTS(SELECT 1 FROM bk_provider_ids p WHERE p.work_id=w.id AND p.provider=${parameter(item.provider)} AND p.provider_id=${parameter(item.id)})`);
  if (!selectors.length) return [];
  const category = search.category ?? 'both';
  const categoryFilter = category === 'both' ? '' : `AND EXISTS(SELECT 1 FROM (
      SELECT s.normalized_label AS label FROM bk_work_subjects ws JOIN bk_subjects s ON s.id=ws.subject_id WHERE ws.work_id=w.id
      UNION ALL SELECT lower(regexp_replace(tag,'[^[:alnum:]]+',' ','g')) FROM unnest(w.tags) tag
    ) labels WHERE label ~ ${parameter(`(^| )(${readingCategoryTerms[category].join('|')})( |$)`)}
      AND label !~ ${parameter(category === 'fiction' ? '(^| )non ?fiction( |$)' : '(^| )science fiction( |$)')})`;
  const limit = parameter(Number.isFinite(search.limit) ? Math.min(160, Math.max(1, Math.floor(search.limit!))) : 48);
  const sql = `SELECT w.*,
    COALESCE((SELECT array_agg(a.name ORDER BY wa.ordinal,a.name) FROM bk_work_authors wa JOIN bk_authors a ON a.id=wa.author_id WHERE wa.work_id=w.id),'{}') authors,
    COALESCE((SELECT array_agg(s.label) FROM bk_work_subjects ws JOIN bk_subjects s ON s.id=ws.subject_id WHERE ws.work_id=w.id AND s.kind='genre'),'{}') genres,
    COALESCE((SELECT array_agg(s.label) FROM bk_work_subjects ws JOIN bk_subjects s ON s.id=ws.subject_id WHERE ws.work_id=w.id AND s.kind='subject'),'{}') subjects,
    COALESCE((SELECT array_agg(e.isbn13) FILTER(WHERE e.isbn13 IS NOT NULL) FROM bk_editions e WHERE e.work_id=w.id),'{}') isbns,
    COALESCE((SELECT array_agg(e.cover_url) FILTER(WHERE e.cover_url IS NOT NULL) FROM bk_editions e WHERE e.work_id=w.id AND (e.language IS NULL OR e.language IN ('eng','en'))),'{}') edition_covers,
    (SELECT e.pages FROM bk_editions e WHERE e.work_id=w.id AND e.pages>0 ORDER BY e.id LIMIT 1) pages,
    (SELECT e.publisher FROM bk_editions e WHERE e.work_id=w.id AND e.publisher IS NOT NULL ORDER BY e.id LIMIT 1) publisher,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',p.provider,'id',p.provider_id)) FROM bk_provider_ids p WHERE p.work_id=w.id),'[]'::jsonb) identifiers,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'position',ws.position)) FROM bk_work_series ws JOIN bk_series s ON s.id=ws.series_id WHERE ws.work_id=w.id),'[]'::jsonb) series,
    COALESCE((SELECT array_agg('pg_'||replace(CASE WHEN r.from_work=w.id THEN r.to_work::text ELSE r.from_work::text END,'-','')) FROM bk_related r WHERE r.from_work=w.id OR r.to_work=w.id),'{}') related
    FROM bk_works w WHERE w.language IN ('eng','en') AND (${selectors.join(' OR ')}) ${categoryFilter}
    ORDER BY (SELECT count(*) FROM unnest(${termParameter}::text[]) t WHERE ${termMatch}) DESC,
      CASE WHEN w.first_published_year BETWEEN EXTRACT(YEAR FROM CURRENT_DATE)::int - 5 AND EXTRACT(YEAR FROM CURRENT_DATE)::int THEN 0
           WHEN w.first_published_year BETWEEN EXTRACT(YEAR FROM CURRENT_DATE)::int - 10 AND EXTRACT(YEAR FROM CURRENT_DATE)::int THEN 1
           WHEN w.first_published_year IS NULL THEN 3 ELSE 2 END,
      w.popularity DESC,w.id
    LIMIT ${limit}`;

  // Bound connection acquisition as well as SQL execution; a read can never enqueue ingestion.
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const acquisition = pool.connect().then(client => { if (expired) client.release(); return client; });
  const client = await Promise.race([acquisition, new Promise<PoolClient>((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error('KNOWLEDGE_CONNECTION_TIMED_OUT')); }, 2000);
  })]).finally(() => clearTimeout(timer));
  let failure: Error | undefined;
  const query = (text: string, values?: unknown[]) => {
    // pg supports this per-query timeout; its QueryConfig declaration omits it.
    const config: QueryConfig & { query_timeout: number } = { text, ...(values ? { values } : {}), query_timeout: 2000 };
    return client.query(config);
  };
  try {
    await query('BEGIN READ ONLY');
    await query("SET LOCAL statement_timeout = '1500ms'");
    const result = await query(sql, values);
    await query('COMMIT');
    return result.rows.map(knowledgeBook).filter((book): book is Book => !!book);
  } catch (error) { failure = error instanceof Error ? error : new Error('KNOWLEDGE_QUERY_FAILED'); throw failure; }
  finally { client.release(failure); }
}

export function findKnowledgeBooks(terms: string[], limit = 60): Promise<Book[]> {
  return queryKnowledgeBooks({ terms, limit });
}
