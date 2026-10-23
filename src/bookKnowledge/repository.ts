import { bookPool } from './db';
export type IngestBook = { title: string; authors: string[]; description?: string; language?: string; coverUrl?: string; year?: number; isbn13?: string; pages?: number; publisher?: string; genres?: string[]; subjects?: string[]; provider: string; providerId: string; relatedProviderIds?: {provider:string;id:string}[] };
const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export async function ingestBook(book: IngestBook): Promise<string> {
 if (!book.title?.trim() || !book.authors?.length || !book.providerId) throw new Error('Book requires title, authors, providerId');
 const client = await bookPool.connect();
 try {
  await client.query('BEGIN');
  let found = await client.query('SELECT work_id FROM bk_provider_ids WHERE provider=$1 AND provider_id=$2',[book.provider,book.providerId]);
  if (!found.rowCount && book.isbn13) found = await client.query('SELECT work_id FROM bk_editions WHERE isbn13=$1',[book.isbn13]);
  // Conservative matching: never collapse works solely because titles resemble each other.
  let id: string;
  if (found.rowCount) { id=found.rows[0].work_id; await client.query('UPDATE bk_works SET description=COALESCE(NULLIF(description,\'\'),$2), cover_url=COALESCE(cover_url,$3), updated_at=now() WHERE id=$1',[id,book.description??null,book.coverUrl??null]); }
  else { const result=await client.query('INSERT INTO bk_works(title,normalized_title,description,language,first_published_year,cover_url) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[book.title,norm(book.title),book.description??null,book.language??'eng',book.year??null,book.coverUrl??null]);id=result.rows[0].id; }
  await client.query('INSERT INTO bk_provider_ids(provider,provider_id,work_id) VALUES($1,$2,$3) ON CONFLICT(provider,provider_id) DO NOTHING',[book.provider,book.providerId,id]);
  for (const [ordinal,name] of book.authors.entries()) { const a=await client.query('INSERT INTO bk_authors(name,normalized_name) VALUES($1,$2) ON CONFLICT(normalized_name) DO UPDATE SET name=EXCLUDED.name RETURNING id',[name,norm(name)]); await client.query('INSERT INTO bk_work_authors(work_id,author_id,ordinal) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,a.rows[0].id,ordinal]); }
  for(const [kind,terms] of [['genre',book.genres??[]],['subject',book.subjects??[]]] as const) for(const label of terms) {if(!norm(label))continue;const s=await client.query('INSERT INTO bk_subjects(label,normalized_label,kind) VALUES($1,$2,$3) ON CONFLICT(normalized_label) DO UPDATE SET label=EXCLUDED.label RETURNING id',[label,norm(label),kind]);await client.query('INSERT INTO bk_work_subjects(work_id,subject_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,s.rows[0].id]);}
  for(const alias of book.relatedProviderIds??[])await client.query('INSERT INTO bk_provider_ids(provider,provider_id,work_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[alias.provider,alias.id,id]);
  if(book.isbn13)await client.query('INSERT INTO bk_editions(work_id,isbn13,publisher,published_year,pages) VALUES($1,$2,$3,$4,$5) ON CONFLICT(isbn13) DO NOTHING',[id,book.isbn13,book.publisher??null,book.year??null,book.pages??null]);
  await client.query('COMMIT');return id;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function searchBooks(terms:string[],limit=80){const q=terms.map(norm).filter(Boolean).slice(0,8);if(!q.length)return [];const r=await bookPool.query(`SELECT w.id,w.title,w.description,w.cover_url,w.first_published_year,COALESCE(array_agg(DISTINCT a.name) FILTER(WHERE a.name IS NOT NULL),'{}') AS authors,COALESCE(array_agg(DISTINCT s.label) FILTER(WHERE s.label IS NOT NULL),'{}') AS subjects FROM bk_works w LEFT JOIN bk_work_authors wa ON wa.work_id=w.id LEFT JOIN bk_authors a ON a.id=wa.author_id LEFT JOIN bk_work_subjects ws ON ws.work_id=w.id LEFT JOIN bk_subjects s ON s.id=ws.subject_id WHERE EXISTS(SELECT 1 FROM unnest($1::text[]) term WHERE w.normalized_title LIKE '%'||term||'%' OR EXISTS(SELECT 1 FROM bk_work_subjects x JOIN bk_subjects y ON y.id=x.subject_id WHERE x.work_id=w.id AND y.normalized_label LIKE '%'||term||'%')) GROUP BY w.id ORDER BY w.updated_at DESC LIMIT $2`,[q,Math.min(200,Math.max(1,limit))]);return r.rows;}
