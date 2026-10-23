export type KnowledgeConfig = { enabled: boolean; maxDepth: number; expansionPerBook: number; dailyDiscoveryJobs: number; refreshDays: number; pollMs: number };
const int = (key:string, fallback:number, lo:number, hi:number) => { const n=Number(process.env[key]); return Number.isInteger(n) && n>=lo && n<=hi ? n : fallback; };
export function knowledgeConfig():KnowledgeConfig { return {
 enabled: process.env.BOOK_KNOWLEDGE_ENABLED === 'true', maxDepth:int('BOOK_KNOWLEDGE_MAX_DEPTH',2,0,5),
 expansionPerBook:int('BOOK_KNOWLEDGE_EXPANSION_PER_BOOK',5,0,20),dailyDiscoveryJobs:int('BOOK_KNOWLEDGE_DAILY_DISCOVERY',120,1,10000),
 refreshDays:int('BOOK_KNOWLEDGE_REFRESH_DAYS',30,1,365),pollMs:int('BOOK_KNOWLEDGE_POLL_MS',10000,1000,600000)
}; }
