import { bookPool } from './db';
import { enqueue } from './jobs';
import { knowledgeConfig } from './config';
import { isReadingDiscoverySubject } from './discoverySubjects';
export async function expandWork(workId:string,depth:number) {
 const cfg=knowledgeConfig();if(depth>=cfg.maxDepth)return 0;
 const row=await bookPool.query(`SELECT w.title,w.expansion_depth,
 COALESCE((SELECT array_agg(a.name) FROM bk_work_authors wa JOIN bk_authors a ON a.id=wa.author_id WHERE wa.work_id=w.id),'{}') authors,
 COALESCE((SELECT array_agg(s.label) FROM bk_work_subjects ws JOIN bk_subjects s ON s.id=ws.subject_id WHERE ws.work_id=w.id),'{}') subjects
 FROM bk_works w WHERE w.id=$1`,[workId]);if(!row.rowCount)return 0;
 const b=row.rows[0];const terms=[...b.authors.slice(0,2).map((a:string)=>`inauthor:${a}`),...b.subjects.filter((s:string)=>isReadingDiscoverySubject(s)).slice(0,3).map((s:string)=>`subject:${s}`)].slice(0,cfg.expansionPerBook);
 for(const term of terms)await enqueue('discover',{term,depth:depth+1,origin:workId});
 await bookPool.query('UPDATE bk_works SET expanded_at=now() WHERE id=$1',[workId]);return terms.length;
}
export async function scheduleDueWork(limit=30){
 const cfg=knowledgeConfig();const stale=await bookPool.query(`SELECT id FROM bk_works WHERE refresh_after<=now() ORDER BY refresh_after LIMIT $1`,[limit]);
 for(const row of stale.rows){await enqueue('refresh',{workId:row.id});await bookPool.query(`UPDATE bk_works SET refresh_after=now()+($2 * interval '1 day') WHERE id=$1`,[row.id,cfg.refreshDays]);}
 const expand=await bookPool.query(`SELECT id,expansion_depth FROM bk_works WHERE expanded_at IS NULL AND expansion_depth<$1 ORDER BY discovered_at LIMIT $2`,[cfg.maxDepth,limit]);
 for(const row of expand.rows)await enqueue('expand',{workId:row.id,depth:row.expansion_depth});
 return {refresh:stale.rowCount,expand:expand.rowCount};
}
export async function relateWorks(workIds:string[],origin?:string){
 if(!origin)return;for(const id of workIds)if(id!==origin)await bookPool.query(`INSERT INTO bk_related(from_work,to_work,relation,weight) VALUES($1,$2,'discovered-together',0.4) ON CONFLICT DO NOTHING`,[origin,id]);
}
