# Loomey — Reusable Self-Growing Book Knowledge Base

**Additive PostgreSQL knowledge graph for Vox API.** Existing MongoDB, regular recommendations, recommendation collections, and automatic catalog endpoints remain unchanged unless you opt into the integration patch.

## Included
- Work/edition/author/series/subject/genre graph, provider IDs, source observations and related-work edges.
- Migration runner, PostgreSQL connection pool, identity helpers, provider-aware ingestion, search and candidate adapter.
- Background discovery, recursive bounded expansion, metadata refresh scheduling, durable queued jobs, retries, crash recovery and maintenance.
- **Reuses Codex's actual Hardcover, Google Books and Open Library provider classes**, their rate limiter, and their book model.
- Optional integration instructions for `src/services/loomeyRecommendations/engine.ts`.
- Unit tests for pure identity helpers and a documented integration-test checklist.

## Important implementation boundaries
This package was prepared against the current Vox API source layout. **It has not been compiled inside Vox API, connected to your Railway PostgreSQL instance, or exercised against live provider APIs.** No files in your repository were modified. The `patches/` file is an example to review, not an automatically applied patch. Review provider caching and licensing terms before persisting third-party data. No user library records are copied into PostgreSQL.

See `docs/INSTALL.md` and `docs/ARCHITECTURE.md`.
