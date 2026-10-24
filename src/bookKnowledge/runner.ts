import 'dotenv/config';
import { bookPool } from './db';
import { recoverInterruptedJobs, seedKnowledge, runKnowledgeWorker } from './index';

async function main(): Promise<void> {
  if (process.env.BOOK_KNOWLEDGE_ENABLED !== 'true') {
    throw new Error('BOOK_KNOWLEDGE_ENABLED must be true for the knowledge worker');
  }
  await recoverInterruptedJobs();
  await seedKnowledge(['fantasy', 'mystery', 'historical fiction', 'science fiction', 'romance']);
  console.log('[bookKnowledge] Worker starting');
  await runKnowledgeWorker();
}

void main().catch(async error => {
  console.error('[bookKnowledge] Worker failed', error);
  await bookPool.end();
  process.exitCode = 1;
});
