import 'dotenv/config';
import mongoose from 'mongoose';
import { bookPool } from './db';
import { recoverInterruptedJobs, seedKnowledge, runKnowledgeWorker } from './index';

const RUN_LIMIT_MS = 10 * 60 * 1000;

async function main(): Promise<void> {
  if (process.env.BOOK_KNOWLEDGE_ENABLED !== 'true') {
    throw new Error('BOOK_KNOWLEDGE_ENABLED must be true for the knowledge worker');
  }

  // The overall run has a strict deadline; Railway also enforces a separate kill timeout.
  const deadline = AbortSignal.timeout(RUN_LIMIT_MS);
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required for provider cache and rate limits');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('[bookKnowledge] MongoDB connected');
  deadline.throwIfAborted();
  await recoverInterruptedJobs();
  deadline.throwIfAborted();
  await seedKnowledge(['fantasy', 'mystery', 'historical fiction', 'science fiction', 'romance', 'literary fiction']);
  console.log('[bookKnowledge] Weekly run started (10-minute maximum)');
  try {
    await runKnowledgeWorker(deadline);
  } finally {
    await Promise.allSettled([bookPool.end(), mongoose.disconnect()]);
    console.log('[bookKnowledge] Weekly run finished');
  }
}

void main().catch(async error => {
  console.error('[bookKnowledge] Worker failed', error);
  await Promise.allSettled([bookPool.end(), mongoose.disconnect()]);
  process.exitCode = 1;
});
