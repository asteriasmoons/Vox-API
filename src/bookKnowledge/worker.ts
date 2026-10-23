import { randomUUID } from 'node:crypto';
import { bookPool } from './db';
import { knowledgeConfig } from './config';
import { expandWork,relateWorks,scheduleDueWork } from './growth';
import { ingestProviderBook } from './sourceBridge';
import { enqueue,workOnce } from './jobs';
import { ProviderTransport } from '../services/loomeyRecommendations/transport';
import { MongoRecommendationStore } from '../services/loomeyRecommendations/repository';
import { HardcoverProvider } from '../services/loomeyRecommendations/providers/hardcover';
import { GoogleBooksProvider } from '../services/loomeyRecommendations/providers/googleBooks';
import { OpenLibraryProvider } from '../services/loomeyRecommendations/providers/openLibrary';
import type { DiscoveryPlan,ProviderContext,DiscoveryProvider } from '../services/loomeyRecommendations/types';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export function existingProviders():DiscoveryProvider[]{const transport=new ProviderTransport(new MongoRecommendationStore());return [new HardcoverProvider(transport),new GoogleBooksProvider(transport),new OpenLibraryProvider(transport)];}
function context():ProviderContext{return {traceID:randomUUID(),signal:AbortSignal.timeout(90000),budgets:{hardcover:8,'google-books':8,'open-library':8}};}
function plan(term:string):DiscoveryPlan {const [prefix,...rest]=term.split(':');const value=rest.join(':').trim();
 if(prefix==='inauthor')return {key:term,kind:'author',categories:['authors-read'],author:value,terms:[],tagIDs:[],workIDs:[]};
 return {key:term,kind:'interests',categories:['genres','themes','discovery'],terms:[prefix==='subject'?value:term],tagIDs:[],workIDs:[]};}
export async function processDiscovery(payload:{term:string;depth?:number;origin?:string},providers=existingProviders()) {
 const ids:string[]=[];const ctx=context();
 for(const provider of providers.filter(p=>p.available())){
  try {for(const book of await provider.discover(plan(payload.term),ctx)){
   const id=await ingestProviderBook(book,payload.depth??0);if(id)ids.push(id);
  }}catch(e){console.warn('[bookKnowledge]',provider.name,e instanceof Error?e.message:'provider failure');}
 }
 await relateWorks([...new Set(ids)],payload.origin);return ids.length;
}
export async function refreshWork(workId:string,providers=existingProviders()){
 const row=await bookPool.query(`SELECT w.title,COALESCE((SELECT array_agg(a.name ORDER BY wa.ordinal) FROM bk_work_authors wa JOIN bk_authors a ON a.id=wa.author_id WHERE wa.work_id=w.id),'{}') authors FROM bk_works w WHERE id=$1`,[workId]);
 if(!row.rowCount||!row.rows[0].authors.length)return;
 const seed={id:workId,title:row.rows[0].title,author:row.rows[0].authors[0],genres:[],subjects:[],status:'Lookup',rating:0,favorite:false,activity:0};
 for(const p of providers.filter(p=>p.available()))try {for(const b of await p.resolve([seed],context()))await ingestProviderBook(b);}catch(e){console.warn('[bookKnowledge] refresh',p.name,e instanceof Error?e.message:'failure');}
}
export async function runKnowledgeWorker(signal?:AbortSignal){
 const cfg=knowledgeConfig();if(!cfg.enabled)throw Error('Set BOOK_KNOWLEDGE_ENABLED=true');
 let lastSchedule=0;
 while(!signal?.aborted){
  if(Date.now()-lastSchedule>60000){await scheduleDueWork();lastSchedule=Date.now();}
  const did=await workOnce({discover:async payload=>{await processDiscovery(payload);},expand:async ({workId,depth})=>{await expandWork(workId,depth);},refresh:async ({workId})=>{await refreshWork(workId);}});
  if(!did)await wait(cfg.pollMs);
 }
}
export async function seedKnowledge(terms:string[]){for(const term of terms)await enqueue('discover',{term,depth:0});}
