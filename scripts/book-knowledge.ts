import 'dotenv/config';
import { migrateKnowledge,seedKnowledge,runKnowledgeWorker,recoverInterruptedJobs,pruneKnowledge,stats,bookPool } from '../src/bookKnowledge';
async function main(){const [cmd,...args]=process.argv.slice(2);try{
 if(cmd==='migrate')await migrateKnowledge();
 else if(cmd==='seed'){await seedKnowledge(args.length?args:['fantasy','mystery','historical fiction','science fiction','romance']);}
 else if(cmd==='worker'){await recoverInterruptedJobs();await runKnowledgeWorker();}
 else if(cmd==='stats')console.log(await stats());
 else if(cmd==='prune')await pruneKnowledge();
 else throw Error('Usage: book-knowledge.ts migrate | seed [terms...] | worker | stats | prune');
 }finally{await bookPool.end();}}
void main().catch(e=>{console.error(e);process.exitCode=1;});
