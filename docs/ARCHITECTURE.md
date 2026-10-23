# Data and growth architecture

**PostgreSQL** stores reusable book metadata and graph edges. **MongoDB** remains the source for Loomey app records and the existing recommendation cache. The new knowledge base never reads or stores personal library histories by default.

Flow: seed topics → queued discovery → Codex provider discovery → normalized `Book` → canonical work and edition ingestion → source provenance → queued bounded related-topic expansion → refresh queue → optional recommendation candidate lookup → existing `rankCategories` and `ownedMatches` → existing MongoDB catalog cache.

### Guardrails
- Provider IDs are authoritative; ISBNs are edition identifiers. Do not merge two works on title similarity alone.
- Provider source observations retain provenance; respect external provider terms.
- Expansion depth and per-work fanout are capped. Duplicate queue payloads are unique.
- A separate worker handles long jobs; HTTP requests don't wait for expansion.
- No changes to `/api/books/recs`, `/api/books/recommendation-collections`, or `/api/books/automatic-catalogs` routes.
- Search candidates are passed through the existing catalog engine's ownership exclusion and scoring.

### Known limitations requiring integration verification
- Current job claiming recovers stale jobs only on worker startup and lacks a heartbeat for very long operations; keep provider timeouts bounded.
- `BOOK_KNOWLEDGE_DAILY_DISCOVERY` is configuration reserved for a daily quota policy; provider-level quotas are enforced by Codex's transport, but a separate daily job counter is not yet wired.
- The example engine patch is manual, not automatically applied.
- Editions from Hardcover and Open Library may require further provider-specific enrichment to capture all edition-level metadata.
