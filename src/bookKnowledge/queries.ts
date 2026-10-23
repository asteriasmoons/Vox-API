import { bookPool } from './db';
import { norm } from './identity';
import type { Book } from '../services/loomeyRecommendations/types';
export async function findKnowledgeBooks(terms:string[],limit=60):Promise<Book[]> {
 const q=terms.map(norm).filter(Boolean).slice(0,8);if(!q.length)return [];
 const {rows}=await bookPool.query(`SELECT w.*, COALESCE((SELECT array_agg(a.name ORDER BY wa.ordinal) FROM bk_work_authors wa JOIN bk_authors a ON a.id=wa.author_id WHERE wa.work_id=w.id),'{}') authors,
 COALESCE((SELECT array_agg(s.label) FROM bk_work_subjects ws JOIN bk_subjects s ON s.id=ws.subject_id WHERE ws.work_id=w.id AND s.kind='genre'),'{}') genres,
 COALESCE((SELECT array_agg(s.label) FROM bk_work_subjects ws JOIN bk_subjects s ON s.id=ws.subject_id WHERE ws.work_id=w.id AND s.kind='subject'),'{}') subjects,
 COALESCE((SELECT array_agg(e.isbn13) FILTER(WHERE e.isbn13 IS NOT NULL) FROM bk_editions e WHERE e.work_id=w.id),'{}') isbns,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',bs.id,'name',bs.name,'position',bws.position)) FROM bk_work_series bws JOIN bk_series bs ON bs.id=bws.series_id WHERE bws.work_id=w.id),'[]'::jsonb) series,
 COALESCE((SELECT array_agg('pg_'||replace(r.to_work::text,'-','')) FROM bk_related r WHERE r.from_work=w.id),'{}') related
 FROM bk_works w WHERE w.language='eng' AND EXISTS(SELECT 1 FROM unnest($1::text[]) t WHERE w.normalized_title LIKE '%'||t||'%' OR EXISTS(SELECT 1 FROM bk_work_subjects ws JOIN bk_subjects s ON s.id=ws.subject_id WHERE ws.work_id=w.id AND s.normalized_label LIKE '%'||t||'%'))
 ORDER BY w.popularity DESC,w.updated_at DESC LIMIT $2`,[q,Math.min(200,Math.max(1,limit))]);
 return rows.filter(r=>r.authors.length).map(r=>({id:'pg_'+r.id.replace(/-/g,''),title:r.title,subtitle:null,authors:r.authors,description:r.description??'',
 isbns:r.isbns,providerIDs:r.provider_ids??{},titleVariants:r.title_variants?.length?r.title_variants:[r.title],genres:r.genres,subjects:r.subjects,
 tags:r.tags??[],authorIDs:r.author_ids??[],tagIDs:r.tag_ids??[],series:r.series.map((s:any)=>({id:String(s.id),name:s.name,position:s.position===null?null:Number(s.position)})),
 relatedIDs:r.related,coverUrls:r.cover_urls?.length?r.cover_urls:r.cover_url?[r.cover_url]:[],language:'eng' as const,pages:null,publisher:null,
 releaseYear:r.first_published_year,popularity:r.popularity??0,sources:(r.source_names??[]).filter((s:string)=>['hardcover','google-books','open-library'].includes(s)) as Book['sources']}));
}
