import 'dotenv/config';
import mongoose from 'mongoose';
import { bookPool } from './db';
import { recoverInterruptedJobs, seedKnowledge, runKnowledgeWorker } from './index';

async function main(): Promise<void> {
  if (process.env.BOOK_KNOWLEDGE_ENABLED !== 'true') {
    throw new Error('BOOK_KNOWLEDGE_ENABLED must be true for the knowledge worker');
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required for provider cache and rate limits');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('[bookKnowledge] MongoDB connected');
  await recoverInterruptedJobs();
  await seedKnowledge(['fantasy', 'mystery', 'historical fiction', 'science fiction', 'romance', 'literary fiction']);
  console.log('[bookKnowledge] Worker starting');
  await runKnowledgeWorker();
}

void main().catch(async error => {
  console.error('[bookKnowledge] Worker failed', error);
  await Promise.allSettled([bookPool.end(), mongoose.disconnect()]);
  process.exitCode = 1;
});
