import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bookPool } from './db';
export async function migrateKnowledge(sqlDirectory = join(process.cwd(),'sql')) {
 const client=await bookPool.connect();
 try { await client.query('SELECT pg_advisory_lock($1)',[742819]);
   await client.query(`CREATE TABLE IF NOT EXISTS bk_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
   for(const name of ['001_init.sql','002_growth.sql']) {
     const exists=await client.query('SELECT 1 FROM bk_schema_migrations WHERE name=$1',[name]); if(exists.rowCount)continue;
     await client.query('BEGIN'); try { await client.query(await readFile(join(sqlDirectory,name),'utf8'));
       await client.query('INSERT INTO bk_schema_migrations(name) VALUES($1)',[name]);await client.query('COMMIT');
     }catch(e){await client.query('ROLLBACK');throw e;}
   }
 } finally {await client.query('SELECT pg_advisory_unlock($1)',[742819]);client.release();}
}
