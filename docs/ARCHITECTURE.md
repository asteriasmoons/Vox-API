# Data and growth architecture

**PostgreSQL** stores reusable book metadata and graph edges. **MongoDB** remains the source for Loomey app records and the existing recommendation cache. The new knowledge base never reads or stores personal library histories by default.

Flow: the existing weekly worker collects and normalizes book knowledge independently. Recommendation requests read that stored knowledge, apply optional Reading Preferences and Finished-history ranking, exclude all owned books, and use external providers only for missing coverage. Completed categories persist in the existing MongoDB catalog cache. See [Reading Preferences integration](READING_PREFERENCES.md).

### Guardrails
- Provider IDs are authoritative; ISBNs are edition identifiers. Do not merge two works on title similarity alone.
- Provider source observations retain provenance; respect external provider terms.
- Expansion depth and per-work fanout are capped. Duplicate queue payloads are unique.
- A separate worker handles long jobs; HTTP requests don't wait for expansion.
- `/api/books/automatic-catalogs` accepts optional reading preferences. `/api/books/recs` and `/api/books/recommendation-collections` remain unchanged.
- Search candidates are passed through the existing catalog engine's ownership exclusion and scoring.

### Known limitations requiring integration verification
- Current job claiming recovers stale jobs only on worker startup and lacks a heartbeat for very long operations; keep provider timeouts bounded.
- `BOOK_KNOWLEDGE_DAILY_DISCOVERY` is configuration reserved for a daily quota policy; provider-level quotas are enforced by Codex's transport, but a separate daily job counter is not yet wired.
- The existing engine now uses a bounded, read-only PostgreSQL source. An HTTP miss never starts collection or enqueues work; the historical example patch is not on the execution path.
- Editions from Hardcover and Open Library may require further provider-specific enrichment to capture all edition-level metadata.
