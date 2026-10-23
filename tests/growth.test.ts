// Integration tests require a disposable PostgreSQL database. Do not run against production.
// Scenario checklist:
// 1. migrate twice; assert idempotence.
// 2. ingest same provider work twice; assert one work and provider identity.
// 3. ingest two editions with distinct ISBNs; assert separate editions under same work.
// 4. enqueue same job twice; assert dedupe.
// 5. simulate worker crash; recover stale running jobs.
// 6. discover a source work; enqueue bounded expansion; assert depth limit.
// 7. feed owned books in any status; assert engine excludes all identities.
// 8. disable BOOK_KNOWLEDGE_ENABLED; existing catalog response remains unchanged.
export {};
