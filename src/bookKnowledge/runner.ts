import 'dotenv/config';
import mongoose from 'mongoose';
import { bookPool } from './db';
import { recoverInterruptedJobs, seedKnowledge, runKnowledgeWorker } from './index';

const RUN_LIMIT_MS = 5 * 60 * 1000;
const TIME_ZONE = 'America/Chicago';
const FIRST_RUN_DAY = Date.UTC(2026, 9, 24) / 86_400_000;

// Railway cron is UTC. Schedule both possible 8 AM Central UTC hours and
// run only at 8 AM local time on alternating calendar days from Oct 24, 2026.
function isScheduledRun(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string): number =>
    Number(parts.find(part => part.type === type)?.value);
  if (value('hour') !== 8) return false;
  const localDay = Date.UTC(value('year'), value('month') - 1, value('day')) / 86_400_000;
  return localDay >= FIRST_RUN_DAY && (localDay - FIRST_RUN_DAY) % 2 === 0;
}

async function main(): Promise<void> {
  if (process.env.BOOK_KNOWLEDGE_RUN_NOW !== 'true' && !isScheduledRun()) {
    console.log('[bookKnowledge] Skipping: outside the every-other-day 8 AM Central schedule');
    return;
  }
  if (process.env.BOOK_KNOWLEDGE_ENABLED !== 'true') {
    throw new Error('BOOK_KNOWLEDGE_ENABLED must be true for the knowledge worker');
  }

  const deadline = AbortSignal.timeout(RUN_LIMIT_MS);
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required for provider cache and rate limits');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('[bookKnowledge] MongoDB connected');
  try {
    deadline.throwIfAborted();
    await recoverInterruptedJobs();
    deadline.throwIfAborted();
    // Rotate discovery topics across runs so the five-minute worker grows beyond
    // a fixed handful of genres. Include nonfiction and contemporary interests.
    const topics = [
      'fantasy', 'mystery', 'historical fiction', 'science fiction', 'romance',
      'literary fiction', 'horror', 'thriller', 'contemporary fiction', 'magical realism',
      'biography', 'memoir', 'history', 'psychology', 'science', 'technology',
      'witchcraft', 'folklore', 'philosophy', 'self improvement', 'art', 'nature',
      'true crime', 'health', 'business', 'poetry', 'graphic novels', 'young adult',
    ];
    const runIndex = Math.floor((Date.now() / 86_400_000 - FIRST_RUN_DAY) / 2);
    const rotated = Array.from({ length: 10 }, (_, index) => topics[(runIndex * 10 + index) % topics.length]!);
    await seedKnowledge(rotated);
    console.log('[bookKnowledge] Discovery run started (5-minute maximum; manual override:', process.env.BOOK_KNOWLEDGE_RUN_NOW === 'true', ')');
    try {
      await runKnowledgeWorker(deadline);
    } catch (error) {
      // Reaching the five-minute limit is the expected end of a cron run.
      // Keep unexpected errors visible and let Railway report genuine failures.
      if (!deadline.aborted || error !== deadline.reason) throw error;
      console.log('[bookKnowledge] Five-minute run limit reached; stopping successfully');
    }
  } finally {
    await Promise.allSettled([bookPool.end(), mongoose.disconnect()]);
    console.log('[bookKnowledge] Worker run finished');
  }
}

void main().catch(async error => {
  console.error('[bookKnowledge] Worker failed', error);
  await Promise.allSettled([bookPool.end(), mongoose.disconnect()]);
  process.exitCode = 1;
});
