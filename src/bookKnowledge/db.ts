import { Pool } from 'pg';
export const bookPool = new Pool({ connectionString: process.env.BOOK_KNOWLEDGE_DATABASE_URL, max: Number(process.env.BOOK_KNOWLEDGE_POOL_SIZE ?? 5), ssl: process.env.BOOK_KNOWLEDGE_DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
