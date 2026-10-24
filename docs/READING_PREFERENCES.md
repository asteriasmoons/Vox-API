# Reading Preferences And Book Knowledge Integration

## Existing API, Optional Preferences

POST `/api/books/automatic-catalogs` retains the existing books/progressive/forceRefresh/categories contract and accepts:

```json
{
  "books": [],
  "progressive": true,
  "preferences": {
    "version": 1,
    "preferredCategory": "fiction",
    "favoriteFictionGenres": ["Fantasy", "Mystery"],
    "favoriteNonfictionGenres": ["History"],
    "currentlyInterestedIn": ["Found family"],
    "recommendationStyle": "blend_interests"
  }
}
```

Categories are `fiction`, `nonfiction`, `both`. Styles are `follow_preferences`, `blend_interests`, `surprise_me`. Omit `preferences` for the original history-only behavior and cache namespace. Invalid configured preferences return `400 INVALID_READING_PREFERENCES`, not silently fabricated defaults. Genre and interest arrays have no selection-count cap. Terms retain the existing type/length validation, text sanitation and 96-character normalization. Every selected value participates in preference profiles, scoring and cache keys; existing provider request budgets remain bounded independently of selection counts. Witchcraft is recognized as nonfiction, without overriding an explicit fiction classification.

The selection-cap and Witchcraft update was reviewed at source level only. Its updated regression tests have not been run; the verification results later in this report predate this update. No compilation, application launch, live provider/database testing or deployment was performed for it. Deploy this API change alongside the iOS selection-catalog update; no new environment variables, database migration, worker schedule or shared material change is required.

No new login, endpoint, credential exchange or user table is needed. Preferences persist in Loomey's existing private CloudKit-backed `UserSettings`; they are supplied per request. PostgreSQL contains reusable book knowledge, not the user's private reading preferences or library history. Request-derived cache keys are hashed; diagnostic events contain counts/style, not the selected interest text.

## Recommendation Behavior

- Follow My Preferences: require a selected active favorite/current-interest match when supplied, prioritize those explicit matches, and scale historical score to 25 percent. History cannot displace books matching the selections.
- Blend My Interests: retain Finished-history relevance and add explicit favorite/current-interest evidence.
- Surprise Me: schedule broader Fiction/Nonfiction searches early enough to fit bounded query budgets, allow broader discovery in Discover Something New, and reward new authors/less-popular matching works.
- Every configured style respects the selected Fiction/Nonfiction category in every section. Both allows either. Primary genre classifications take precedence over incidental subjects; Science Fiction is not treated as Science nonfiction.
- Only Finished books supply positive historical/author/series signals. Every library status remains excluded using canonical identifiers, equivalent ISBNs and normalized title/author matching.

Existing seven category names/meanings, per-category ranking, author/series/genre diversification, independent category pools and cross-section deduplication are retained. Preferences can supply discovery inputs before a user's first Finished book; author/related sections still need meaningful supporting history.

## PostgreSQL Read Path

The existing `bookPool` is reused. `PostgresBookKnowledgeSource` is injected into the existing `LoomeyRecommendationEngine`, not a separate engine or a worker-backed provider.

1. Resolve Finished seed identities against stored titles/aliases and ISBNs, validating title/author or identifier compatibility.
2. Search stored genres, subjects and tags, author bibliographies, named series and related work IDs. Query the existing `bk_works`, `bk_authors`, `bk_work_authors`, `bk_editions`, `bk_provider_ids`, `bk_subjects`, `bk_work_subjects`, `bk_series`, `bk_work_series` and `bk_related` tables.
3. Normalize stored metadata into the same `Book` representation as provider results. Union identifiers from both provenance JSON and the provider ID table. Preserve PostgreSQL graph IDs across external merges; cache their aliases for detail lookup.
4. Exclude owned/invalid records, rank within the existing categories, persist usable progress, then check the globally deduplicated visible sections.
5. If meaningful requested sections have at least four usable stored cards each, finish without external discovery/enrichment. Otherwise, request external discovery for underfilled sections only. Metadata lookup skips seeds already resolved locally.
6. Merge compatible editions across PostgreSQL, Hardcover, Google Books and Open Library. Existing optional bookdatabase.io enrichment remains isolated under its existing licensing policy.

SQL uses bound values, English metadata filtering, bounded result limits, read-only transactions, a 1.5-second transaction-local statement timeout, a 2-second client query timeout and a 2-second connection acquisition limit. Failed connections are discarded rather than returned with an unfinished transaction. An API-only pool error listener handles idle disconnects without terminating the server. The shared pool's configuration is unchanged. The parameterized SQL references only existing migration 001/002 fields; no new database or schema migration was added.

Source lookups use the existing Mongo recommendation cache and distributed deduplication with a five-minute TTL. Category pools retain their existing six-hour freshness/seven-day retention and failure recovery. A database miss/error does not erase usable cached sections or prevent external fallback. Preferences participate in profile/job keys; meaningful changes refresh results, but selection ordering does not.

## Worker Protection

Recommendation queries do not import worker/job/ingestion entry points, enqueue jobs, refresh knowledge rows, run migrations or collect provider books. The old `knowledgeCandidates` helper no longer queues discovery on a miss.

The existing once-weekly Railway configuration was not accessed or changed. `runner.ts` retains its ten-minute limit. `worker.ts`, `config.ts`, `growth.ts`, `jobs.ts`, `sourceBridge.ts`, ingestion repository, SQL migrations and dependency files are unchanged. Hardcover's new exact-tag text filter is gated to preference-driven recommendation plans; existing worker plans do not acquire a new query behavior.

## Deployment Requirements

- Deploy the updated existing API service only when authorized; no deployment was performed.
- Make the existing `BOOK_KNOWLEDGE_DATABASE_URL` available to the API service, not just the scheduled worker. Keep `BOOK_KNOWLEDGE_DB_SSL`/pool settings consistent with the existing environment and valid certificate trust. Credentials never enter iOS.
- Existing `sql/001_init.sql` and `sql/002_growth.sql` tables/columns must already exist. No migrations were run here; do not reset or recreate existing tables/data.
- `BOOK_KNOWLEDGE_ENABLED` continues controlling the worker, not read access. Missing database configuration disables the optional local source and preserves provider-based recommendations.
- Keep existing `HARDCOVER_API_TOKEN`, `GOOGLE_BOOKS_API_KEY`, `BOOKDATABASE_API_KEY` and optional `OPEN_LIBRARY_CONTACT_EMAIL` configuration. No new provider key is needed.
- Release the matching iOS preference payload/persistence implementation and promote its two additive settings attributes through the existing CloudKit release process. No new authentication requirement was added.

## Verification Boundary

124 backend tests passed across `tests/loomey-recommendations.test.mjs` and `tests/automatic-catalogs.test.mjs`, including the optional request contract, modes, category selection, query construction, PostgreSQL row normalization, injected read-to-engine pipeline, seven populated sections with zero external calls, partial/empty/failed local fallback, duplicate editions, detail output, idle connection failure handling and persistent cache preservation. `npm run build` passed.

Loomey's generic iOS build, 89 mocked catalog contract checks and 42 isolated SwiftData persistence checks passed. See [the app report](/Users/asteriasmoons/Desktop/Lumey/READING_PREFERENCES.md).

No PostgreSQL server, production database, worker, provider, SSH session or application/device was exercised. SQL responses were injected fixtures; real schema permissions, SQL execution/query plans, catalog coverage, certificate configuration, live provider data, CloudKit sync and rendered browsing remain unverified. No deployment, Railway configuration change, database write or schema promotion was performed.

## Backend Files Created

| File | Purpose |
| --- | --- |
| `src/services/loomeyRecommendations/readingPreferences.ts` | Parse and validate preferences; active favorites, classification and explicit evidence. |
| `src/services/loomeyRecommendations/knowledgeSource.ts` | Existing-pool read adapter, metadata/source resolution, cached independent search plans. |
| `docs/READING_PREFERENCES.md` | API contract, integration, worker boundary, verification and deployment guide. |

## Backend Files Modified

| File | Purpose |
| --- | --- |
| `src/bookKnowledge/queries.ts` | Existing-schema parameterized read queries, bounded timeouts and normalized identifiers/covers/relationships. |
| `src/bookKnowledge/knowledgeProvider.ts` | Remove request-side discovery enqueueing on a catalog miss. |
| `src/routes/automaticCatalogs.ts` | Validate and forward optional preferences for both progressive and awaited requests. |
| `src/services/loomeyRecommendations/types.ts` | Preference contract, optional internal graph identities/read source and preference-plan marker. |
| `src/services/loomeyRecommendations/strategies.ts` | Preference-aware discovery/scoring, category enforcement, cache signatures and preserved graph relationships. |
| `src/services/loomeyRecommendations/engine.ts` | Read PostgreSQL first, preserve progress, fill underpopulated sections externally and reuse local detail metadata. |
| `src/services/loomeyRecommendations/index.ts` | Wire the local read source into the existing engine and export preference parsing. |
| `src/services/loomeyRecommendations/normalization.ts` | Merge/deduplicate internal PostgreSQL graph identities across providers. |
| `src/services/loomeyRecommendations/catalogCache.ts` | Retain PostgreSQL detail aliases alongside existing provider aliases. |
| `src/services/loomeyRecommendations/providers/hardcover.ts` | Schema-supported exact tag-name query for preference-driven plans only. |
| `tests/loomey-recommendations.test.mjs` | Preference, route, PostgreSQL read/fallback/cache/normalization and worker-isolation contracts. |
| `docs/INSTALL.md` | Replace the old manual integration step with the active read integration and preserved weekly-job requirements. |
| `docs/ARCHITECTURE.md` | Document the now-connected read-only catalog path rather than a future example patch. |

## References

- [node-postgres parameterized queries](https://node-postgres.com/features/queries)
- [node-postgres client configuration](https://node-postgres.com/apis/client)
- [PostgreSQL statement timeout](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-STATEMENT-TIMEOUT)
