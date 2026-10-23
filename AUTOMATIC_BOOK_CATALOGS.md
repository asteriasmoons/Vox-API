# Loomey Recommendation Engine

Source implementation: 2026-10-23. This is a **new, independent recommendation subsystem**, not a wrapper around the former AutomaticCatalogService. No deployment or live provider/device test was performed.

## Architecture

`src/services/loomeyRecommendations/` owns its contracts, provider adapters, normalization, identity matching, discovery plans, relevance scoring, diversification, category allocation, persistence and jobs. It uses the existing Express process and existing `lumeyDB` Mongo connection. It does not import the old recommendation service, ranking, identity helpers, candidate orchestration or category cache.

The existing `/api/books/automatic-catalogs` router now uses `loomeyRecommendationEngine`. Existing maintenance uses the new bookdatabase.io supplement, not the old engine. Old implementation files remain in the repository, but neither the router nor maintenance starts that engine. Collections and unrelated recommendation features are not removed.

Flow:

1. Parse existing Loomey library identities. Only Finished books supply interests; every owned book supplies exclusion identities.
2. Extract existing genres, topics/tags/tropes, authors and series. Ratings/favorites weight interest discovery; low-rated Finished books are downweighted rather than silently removed.
3. Resolve up to eight author-diverse Finished sources through Hardcover; Google/Open Library each resolve up to four. Source lookups are isolated and bounded at 35 seconds per provider.
4. Build independent author, series, related-work and shared-interest query plans for the requested stale categories. Query providers concurrently, but serialize each provider's bounded plans through shared rate reservations.
5. Merge compatible candidates, exclude owned works/editions and score actual metadata. At most 64 new candidates per provider are retained. One source cannot monopolize the entire discovery budget.
6. Persist normalized independent records and progressive category pools. Enrich up to twelve strongest incomplete/thumbnail-only candidates; use bookdatabase.io for at most three useful supplementary lookups.
7. Persist each category independently and return globally deduplicated, diversified rows to the existing interface.

There is no AI, embedding, generative recommendation call, hardcoded book list or provider-personalization endpoint.

## Providers And Configuration

Configure these through the existing backend's environment/secret management. Never place them in the iOS app or commit their values.

| Variable | Purpose |
| --- | --- |
| `HARDCOVER_API_TOKEN` | Enables Hardcover catalog queries; a token with or without the `Bearer ` prefix is accepted. |
| `GOOGLE_BOOKS_API_KEY` | Reuses the project's existing Google Books key; configure it for reliable production quota/identification. Unkeyed public requests may be refused by Google. |
| `BOOKDATABASE_API_KEY` | Existing optional supplementary provider. Its absence does not disable the recommendation engine. |
| `OPEN_LIBRARY_CONTACT_EMAIL` | Recommended application identification. Without it, use the conservative unidentified-request rate. |
| `MONGODB_URI` | Existing Mongo connection, unchanged. |

Existing optional `BOOKDATABASE_DISABLED=true` and `BOOKDATABASE_SUBSCRIPTION_EXPIRES_AT` remain supported. An expiry timestamp is **not required**. Disabling/revoking this provider removes only its licensed supplements, not independent recommendations.

Hardcover uses the documented `https://api.hardcover.app/v1/graphql` endpoint and backend Authorization header. Queries use actual `books`, `editions`, `languages`, `contributions.author`, `book_series.series`, `taggings.tag`, `cached_tags` and `cached_similar_book_ids` fields. Exact filters, language relationships and bounded search-ID fallback are used instead of disabled wildcard operators. Catalog relationship IDs supply candidates only; Loomey performs the personalization and ranking.

Google uses documented volumes searches (`inauthor`, `subject`, `intitle`, `isbn`) and volume details, `langRestrict=en`, pagination and returned image links. The key is sent only on backend Google requests using the documented key parameter; logs never include query strings. Open Library uses English-filtered search with selected-edition fields, author/subject searches, work/edition detail relationships and associated cover IDs/OLIDs. No unsupported series-search field is assumed for Google or Open Library.

Local protection limits are conservative ceilings, not claims about a subscription's actual quota:

| Provider | Start spacing | Daily engine ceiling | Request timeout |
| --- | --- | --- | --- |
| Hardcover | 1,100 ms, below 60 requests/minute | 5,000 | 18 seconds |
| Google Books | 250 ms | 1,000 | 10 seconds |
| Open Library | 1,100 ms; 400 ms with contact identification | 1,500 | 12 seconds |
| bookdatabase.io | Existing shared 1,100 ms reservation | Existing 5,000/UTC day | 8 seconds for supplements |

Mongo compare-and-set reservations coordinate concurrent workers. Individual generation budgets additionally cap Hardcover/Google/Open Library at 24/24/22 uncached HTTP attempts. Retries count against budgets. Discovery uses at most ten Hardcover and nine Google/Open Library plans; pagination is bounded. Public metadata caches and request leases deduplicate repeated lookups across readers and restarts. Other existing app features retain their existing provider clients.

## Matching, Ranking And Categories

Work identity combines namespaced provider IDs, checksum-valid equivalent ISBN-10/13 values, actual title variants and normalized author/title forms. Candidate metadata merges require compatible identities/authors. Ownership exclusions accept a matching valid ISBN even when an owned record lacks its title/author. Provider namespaces cannot collide. Bridge records merge alternate provider editions before category allocation.

Normalization removes HTML, control/whitespace artifacts and recognized binding/edition suffixes. Meaningful subtitles and installment numbers are retained. Source fields prefer Hardcover, then Google, then Open Library, without replacing complete data with missing values. Provider identifiers, aliases and associated cover alternatives remain attached. Existing Loomey Book UUIDs and stored metadata are never rewritten.

Base relevance weights: shared specific genre 4 (maximum three), theme/tag 6 (maximum four), finished author 18, verified series 28, catalog relationship 8, and up to three matching Finished books at 2 each. Generic/promotional labels do not score. Duplicate taxonomy labels count once; a provider's flat categories cannot erase themes explicitly recorded in Loomey. Name-only series matching additionally requires a compatible Finished author.

| Existing Category | Qualification And Ranking |
| --- | --- |
| You Might Also Like | Multiple specific interests, a series relationship, or finished author plus a theme; extra weight for overlap across completed books. |
| Based on Your Favorite Genres | A relevant genre and at least two distinct interest signals; genre-focused bonus. |
| Explore Similar Themes | A relevant theme and multiple interest signals; theme-focused bonus. |
| Discover New Authors | Authors absent from Finished sources and multiple matching interests. Reading/TBR authors do not become preferences. |
| More From Authors You Read | Verified Finished author overlap, with unread titles only. |
| Related Books | Verified series/catalog relationships; otherwise a strong same-source genre plus at least two themes. The latter is metadata relatedness, not an invented provider relationship. |
| Discover Something New | New authors matching multiple interests, with a bounded less-popular-book bonus. |

Greedy diversification penalizes repeated authors, series and genres within a category; author/series caps prevent domination. Category pools retain up to 64 qualified records so early truncation cannot starve seven globally deduplicated rows. Allocation reserves narrow categories, then fills rows round-robin to six cards. No work appears twice across displayed categories. Categories with fewer than two usable, qualifying books are omitted rather than filled with unrelated books. All seven strategies are implemented; actual population depends on the reader's Finished metadata and provider coverage.

## Cache And Job Lifecycle

- `LoomeyRecommendationCache` and `LoomeyRecommendationBudget` are feature collections on the existing `lumeyDB` connection, not a separate database/server. TTL indexes bound retention. No raw personal library/history body is persisted; category keys hash the Finished profile.
- Normalized independent books and category pools survive process restarts for at most seven days. Fresh categories refresh after six hours. Public provider responses normally cache for six hours; the language list caches for one day.
- The app's existing root lifecycle hook loads protected, atomic disk snapshots immediately, prepares missing/stale rows at active startup and refreshes on Finished-data changes/foreground opportunities. The catalog view observes prepared state instead of starting generation itself. Existing compatible snapshots stay visible while the new engine replaces them.
- Adding an owned book filters saved backend/iOS results immediately. If an ownership change drains a previously populated pool, that category is replenished. Unfinished ratings/activity/genres/series cannot change the personalization profile.
- Failed category refreshes preserve their previous results and original hard expiry. Other categories continue independently. Successful empty results and failed requests have distinct states. Failed categories retry after five minutes; unchanged fresh categories are not regenerated.
- Jobs run in the existing Express process, with a three-minute deadline, 45-second renewable ownership lease and 15-second heartbeat. Polls read saved category progress. Another process can reclaim a lost lease on a subsequent request. This is not a durable external queue; a restart can interrupt in-flight work but cannot erase completed categories.
- iOS background suspension cancels polling, not an already-dispatched server job. No guaranteed suspended execution or new background entitlement is assumed. Foreground activation resumes preparation.

bookdatabase.io supplements are stored separately under a licensed cache group for at most 24 hours and are never written into the independent base records. Rendering overlays them only while access/expiry permits. The app honors per-record metadata expiry and scoped provider disable information. Fifteen-minute existing-process maintenance checks optional provider access and purges only licensed/retired provider caches on revocation. Offline copies learn revocation on their next response and expire within their recorded bounds; cancellation cannot be detected instantly on a disconnected device.

## Covers, Details And Network Failures

Cards require real metadata and an associated cover reference. Prefer actual returned full-size images over thumbnails. Open Library uses the verified English edition's cover/OLID before a compatible work fallback; a foreign work title's cover is not assigned to its English edition. Alternative provider URLs are interleaved so one provider's image sizes do not consume every fallback attempt. No unrelated cover is substituted.

The existing iOS cover cache persists validated image bytes, not expiring signed URLs, with three concurrent preload tasks and bounded memory/disk retention. New metadata is published before cover prefetch completes, so image latency cannot block catalog browsing. HTML, corrupt/one-pixel/oversized images fail independently. A failed cover falls through to the same book's other associated URLs; failed cards do not invalidate another row or erase saved catalog metadata.

Provider requests use independent timeouts, at most one transient retry, shared rate-limit cooldowns and two-consecutive-failure discovery stops. Hardcover errors do not gate Google/Open Library. Partial Open Library details retain valid search metadata. A single provider's access denial never clears independent categories. All API redirects stay on the provider's HTTPS origin; normal Node/URLSession certificate validation is unchanged. No ATS exception or certificate bypass was added.

The former raw frontend TLS error could surface from the catalog POST to the existing backend host; source changes cannot prove the production certificate/handshake cause. Diagnostics now distinguish API, resolver and image stages. The live TLS chain remains unverified and must not be described as repaired based on mock tests.

## Existing Endpoints

All responses retain existing per-address request limits and `Cache-Control: private, no-store`. No Apple sign-in or token exchange is added.

| Method | Path Under `/api/books/automatic-catalogs` | Behavior |
| --- | --- | --- |
| POST | `/` | `{books, progressive:true, forceRefresh?, categories?}`; cached rows immediately, HTTP 202 while building, bounded same-input polling. |
| GET | `/books/:id` | New engine's saved normalized metadata. |
| GET | `/books/:id/library-metadata` | Independent saved metadata suitable for adding a book to the existing library. |
| POST | `/books/:id/library-metadata` | Also accepts the displayed card's title/author/ISBN, allowing older cached cards to resolve independent metadata through the new adapters. This is a metadata lookup, never a Finished signal. |
| GET | `/images/:id` | Existing backend-only bookdatabase.io signed HTTPS image resolver. |

Non-progressive POST remains compatible. `X-Loomey-Catalog-Trace` correlates frontend/server logs. Logs include provider, stage, request digest, counts, timings and safe error codes, not tokens, query strings, raw reading history, signed URLs or provider response bodies.

## Verification And Changed Files

See the [cross-project implementation report](/Users/asteriasmoons/Desktop/Lumey/AUTOMATIC_BOOK_CATALOGS.md) for the exact file manifest, current check results and verification boundary. Automated checks use injected transports, temporary storage and fake Mongo models. No live API/database/SSH/device tests, app launches, simulator boots or deployments are authorized by these results.

Official references consulted:
- [Hardcover getting started and limits](https://docs.hardcover.app/api/getting-started/), [search](https://docs.hardcover.app/api/guides/searching/), [published GraphQL schema](https://github.com/hardcoverapp/hardcover-docs/blob/main/schema.graphql).
- [Google Books usage](https://developers.google.com/books/docs/v1/using), [volumes list](https://developers.google.com/books/docs/v1/reference/volumes/list), [volume metadata](https://developers.google.com/books/docs/v1/reference/volumes).
- [Open Library usage/rates](https://openlibrary.org/developers/api), [search/English editions](https://openlibrary.org/dev/docs/api/search), [works/editions](https://openlibrary.org/dev/docs/api/books), [covers](https://openlibrary.org/dev/docs/api/covers).
- [bookdatabase.io documentation](https://bookdatabase.io/documentation), [OpenAPI](https://bookdatabase.io/api/v1.yaml), [temporary caching/subscription terms](https://bookdatabase.io/terms-of-service).

Hardcover's API is beta and tokens/permissions may change. Open Library requests must remain user-driven, identified, cached and bounded, not a high-traffic catalog mirror; register the application/use case as requested by its guidelines. Provider API access does not establish unrestricted rights to every cover image. Production credentials, access/usage eligibility, live data quality and actual coverage require operator verification.
