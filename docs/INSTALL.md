# Installation in Vox API

1. Provision Railway PostgreSQL. Configure `BOOK_KNOWLEDGE_DATABASE_URL` in the Vox API environment. Keep MongoDB configured exactly as it is.
2. Copy `src/bookKnowledge/` into existing `src/bookKnowledge/`, `sql/` into repo `sql/`, and `scripts/book-knowledge.ts` into `scripts/`.
3. Install dependency `npm install pg` and `npm install -D @types/pg`. Existing `dotenv`, TypeScript and Node 20+ are used.
4. Run migrations **from the repository root**: `npx ts-node scripts/book-knowledge.ts migrate` (or compile with your existing TypeScript build and execute the JS). Use a staging database first.
5. Set `BOOK_KNOWLEDGE_ENABLED=true` only after verifying credentials and tables. Seed a few interests: `npx ts-node scripts/book-knowledge.ts seed fantasy mystery`.
6. Run one separate Railway worker process with `npx ts-node scripts/book-knowledge.ts worker` or the compiled JS. Do not launch duplicate worker processes until job lease semantics are validated.
7. Check growth with `npx ts-node scripts/book-knowledge.ts stats`.
8. Review `patches/engine-integration.example.ts` to connect PostgreSQL candidates to Codex's catalog engine. Keep the existing provider calls, `ownedMatches` exclusions and MongoDB catalog cache.
9. Test end-to-end with a disposable library: finished books should influence ranking, while **all** owned statuses should be excluded.

## Important
- The default disabled flag keeps existing behavior intact.
- Run the worker in a separate Railway service, not inside Express startup.
- Provider keys, quotas, attribution, and content licensing must be checked before operating at scale.
- Migration SQL 001 is included for a new database; 002 extends it. Never apply 001 blindly to a database with conflicting tables.
- The example integration patch must be reviewed for exact engine compatibility before production deployment.
