# Loomey automatic book catalogs

## Configuration and deployment

This feature extends this existing Express/MongoDB service. There is no second backend.

Required: `BOOKDATABASE_API_KEY` in the existing host's secrets/environment and the existing `MONGODB_URI`.
The key is already present in the local `.env`; it is not copied into app source, responses, logs, or documentation.
Deploy the updated backend using the existing `npm run build` / `npm start` or Docker workflow before shipping the iOS change.

Optional configuration:

- `BOOKDATABASE_DISABLED=true`: disable all provider reads, purge temporary catalogs at startup and maintenance, and reject catalog data requests.
- `BOOKDATABASE_SUBSCRIPTION_EXPIRES_AT`: optional ISO paid-through bound. Not required. Without it, provider access is revalidated every 15 minutes.

Catalogs do not require Sign in with Apple or any catalog-specific credentials. There is no catalog token exchange. The provider key remains exclusively on this backend. Existing app authentication and user/library/Collections APIs are unchanged.

## Endpoints

All responses are `private, no-store`. These routes accept requests without an Authorization header and apply per-address request limits independently of shared provider quotas. Recommendations depend on the submitted library signals, not an Apple identity or submitted account ID. There is no endpoint to retrieve another library's cached catalogs by identifier.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/books/automatic-catalogs` | Accept `{ books: [...] }`, return expiring personalized catalogs. |
| GET | `/api/books/automatic-catalogs/books/:id` | Full metadata for a provider work and a compatible edition. |
| GET | `/api/books/automatic-catalogs/books/:id/library-metadata` | Independently sourced Google Books/Open Library metadata suitable for saving to the user's library. |
| GET | `/api/books/automatic-catalogs/images/:id` | Resolve the documented 302 image-content endpoint without forwarding the provider key to the image host/app. |

The POST also accepts `progressive: true`. It immediately returns HTTP 202 with `state: "building"`, the currently available catalogs, and `Retry-After: 4`. Repeat the same POST to obtain newer snapshots until `state` is `ready` or `failed`. `forceRefresh: true` on the first request retries a failed/incomplete fetch; omit it on subsequent polls. Existing clients without this flag retain their original response contract. No additional authentication is required.

Generation continues in this existing Express process, using the existing Mongo feature cache and owner-checked lease for cross-worker deduplication. No new backend, queue, database, or worker service is introduced. Jobs have a two-minute overall deadline; polling and provider requests are cancellable/bounded. Process restarts leave only expiring snapshots/leases, not permanent jobs or personal input profiles.

Book signals: local opaque ID, title, author, ISBN, existing genres/topics, rating, favorite flag, reading status, and an aggregate of recent pages/minutes. No session notes, review text, email, or name is sent. Books are capped at 1,000 per request with validation, not silently truncated. The app uses the same backend host as the existing features.

## Actual provider contract

Sources inspected before implementation:

- [Documentation](https://bookdatabase.io/documentation)
- [OpenAPI v1](https://bookdatabase.io/api/v1.yaml)
- [Published plans](https://bookdatabase.io/)
- [Terms, sections 7 and 9](https://bookdatabase.io/terms-of-service)

`/books` are works; `/editions` carry ISBNs, page counts, publishers and genres. Subjects and author references belong to works. Both `_link` (OpenAPI spelling) and `_links` (live response spelling) are supported. Pagination follows the supplied next link, not guessed numeric pages. Provider redirects are never followed with the API key. All HAL links are restricted to the documented HTTPS API origin and `/v1/` path. Returned resource IDs, search criteria and requested relationships are checked to reject responses that do not honor the request.

There is no documented direct book-to-book recommendation edge, author-similarity API, genre name search, subject name search, or publication-year field on this edition schema. We do not invent any. Related Books is inferred from multiple shared subjects/genres, not advertised as an explicit publisher/provider relation. New authors are authors of matching works, not a fabricated author-relationship graph. Publication year remains absent when unavailable.

## Matching and ranking

ISBN-13/10 are checked, ISBN-10 can be canonically compared to ISBN-13, and editions resolve to works. A conflicting title/author or edition-to-work relationship is not accepted solely because an ISBN matched. Fallback is normalized exact title and author, using both the work-title index and the separately documented edition-title index; ambiguous work matches are excluded rather than guessed. Loomey's current Book model has no compatible stored provider work ID or Google/Open Library identifier, so none is fabricated or migrated into it.

Up to four strong existing library signals seed a bounded graph expansion. Favorites, high ratings, current/finished status and recent reading influence seed priority. DNF/archived and low-rated titles remain exclusions but do not drive positive recommendations. Library genres/topics provide additional preference weighting.

Discovery pages request `includeRelationships=None` and stream HAL pages as they arrive. Candidate IDs are then resolved to full work and compatible edition records with `includeRelationships=All`; this changes when data is fetched, not which metadata fields or catalog types are supported. Edition selection follows the work's documented edition references rather than fetching another expanded result page. A later page or relationship outage does not erase earlier verified results. The first seed's author recommendations can be published while all remaining seeds/subjects/genres continue loading.

Specific genres score 3, subjects 5, same author 4, and a genre-plus-subject combination adds 5. Very broad classifications such as Fiction, General and Literature do not score. Counts are capped to prevent metadata-rich records from dominating. Strongest matches rank first with deterministic ID tie breaks. All existing library identities, source works, duplicate work IDs, ISBN equivalents and title/author duplicates are excluded. Catalog allocation also prevents repetition across rows.

Catalog types are similar books, favorite genres, similar themes, new authors, familiar authors, related books and broader discovery. Each row requires at least two qualifying records and includes at most six. Missing categories are omitted, never filled with unrelated books. Candidate expansion is bounded to eight metadata queries, up to two pages each and 22 candidate work enrichments, not an unrestricted crawl. Cold generation may take tens of seconds under the one-per-second plan, but progressive HTTP calls return promptly and already available rows can be shown before generation finishes. All seven catalog predicates and the original four-seed coverage remain in use.

## Caching, quota and outages

- Existing MongoDB/Mongoose infrastructure stores only expiring feature-specific documents, not a permanent catalog mirror.
- Metadata TTL is six hours by default, never more than 24 hours; negative lookups last 15 minutes; image URLs last four minutes because provider URLs are valid for five.
- Personalized outputs last one hour, or five minutes when partial. Cache keys hash the complete normalized library input, including local opaque book IDs, so library/rating/status/reading changes invalidate output. No raw personal input profile is persisted.
- Identical fetches coalesce in-process and through owner-checked Mongo leases across workers.
- Cached catalog responses do not wait for a random-book request. The existing periodic maintenance still checks provider access every 15 minutes.
- Atomic Mongo rate reservations enforce at least 1,100 ms between provider request starts across all workers, including midnight. A durable UTC daily counter caps requests at 5,000 even after a restart. Conservative reservations count failed calls too; the provider may refund 5xx against its own count.
- Timeouts and 5xx receive one bounded retry, with a new rate/quota reservation. Auth/quota/invalid-record errors are not blindly retried. Missing records are negative-cached. Provider responses are validated before caching.
- Requests are rate-limited by server-observed client address independently of the shared subscription budget. Catalog/data requests allow 20 per minute and image resolution allows 90 per minute. Existing proxy configuration is unchanged; clients sharing a server-observed proxy address share that limit. Health checks run every 15 minutes and use the same cached/rate-limited client, consuming at most about 96 daily calls.
- Provider `NO_API_CALLS_REMAINING` (documented HTTP 400) and HTTP 429 are handled explicitly with retry information. Access-denied responses purge provider-derived caches. Mongo outages fail closed rather than bypassing quota controls.
- iOS stores catalog responses and cover bytes only in bounded, expiring memory caches. No catalog credentials are stored. Offline unexpired responses can be reused; other offline/error/empty states offer retry.

## Subscription cancellation

The terms permit temporary caching while subscribed and require removing stored/cached provider data when access ends. No renewal date is required by this implementation. Provider access checks detect denial within a maintenance interval, but the API does not document a subscription-status webhook or endpoint. If cancelling, set `BOOKDATABASE_DISABLED=true` and restart all backend workers; do not wait for a failing provider call. For immediate cleanup after disabling:

```sh
npm run build
node scripts/purge-automatic-catalogs.mjs
```

Only AutomaticCatalogCache is purged. Collections, user libraries, reading history, and existing recommendation shelves are not touched. The app's temporary catalog data expires; independently verified Google/Open Library data saved to a user's library is not provider-owned catalog content and is retained. New library saves never fall back to bookdatabase.io descriptions/pages/classifications if independent metadata is unavailable.

## Verification and live limitation

The deterministic suite is `node --test tests/automatic-catalogs.test.mjs`. It runs the current TypeScript source through the existing ts-node development runtime, without producing a project build or relying on stale `dist` files. It covers HAL parsing/streaming/pagination, link safety, provider-key header authentication, ISBN/work matching, conflicting metadata, multi-signal scoring, deduplication, cache TTL and coalescing, cross-worker rate/daily quota controls, errors, sign-in-free endpoints, progressive snapshots/background completion, deadlines, retries, request throttling, and independent library metadata. Swift contract checks were updated but not compiled or executed for this fix.

On 2026-10-22 local live checks authenticated successfully and read edition/work responses. However, `/books?searchQuery=QzxNoSuchBookTitle88492&pageSize=1&includeRelationships=None` returned a record titled `George Eliot`, despite echoing the nonsense query in `_links.self`. A Fantastic Mr. Fox title query returned the same unrelated George results. The separate documented edition-title search successfully resolved Dune to Frank Herbert, so that fallback is implemented and tested. The subsequent live relationship expansion still failed to produce trustworthy catalog rows; live personalized output remains unverified. Matching/filter checks reject unrelated records rather than treating a 200 response as recommendation success. This behavior needs resolution/clarification from the provider; no invented alternate endpoint or unrelated filler is used. Logs expose stage/error code only, not reader inputs or API credentials.

The broader existing `npm test` suite also reports journal-analysis/provider-split expectation failures in unchanged AI services. Those services and their tests were intentionally not rewritten for this metadata-only feature.

On 2026-10-23 the deployed synchronous catalog request took 94.7 seconds and returned `PROVIDER_UNAVAILABLE`. With the corrected source and real provider/Mongo data, an HTTP integration check returned the initial progress response in 669 ms and displayed four fully resolved book records on the first four-second poll; status calls took approximately 180-240 ms. Remaining subject/genre lookups continued independently. The provider still failed a subject request, so that diagnostic finished as incomplete rather than claiming all metadata was available. Incomplete results remain explicitly retryable. These source changes have not been deployed by the coding agent.

## Backend file manifest

New:
- `src/services/bookDatabaseClient.ts`: documented API, HAL, validation, request coalescing and temporary cache access.
- `src/services/automaticCatalogStore.ts`: feature-only Mongo TTL caches, leases, quota/rate controls and purge.
- `src/services/automaticCatalogService.ts`: library validation, reliable matching, ranking and catalog allocation.
- `src/services/catalogLibraryMetadata.ts`: independent metadata for permanent library saves, no AI.
- `src/services/automaticCatalogMaintenance.ts`: existing-process periodic access checks and disabled-state cleanup.
- `src/routes/automaticCatalogs.ts`: sign-in-free feature routes, per-address throttling and consistent safe errors.
- `scripts/purge-automatic-catalogs.mjs`: operator cleanup of feature caches only.
- `tests/automatic-catalogs.test.mjs`: deterministic feature coverage.
- `AUTOMATIC_BOOK_CATALOGS.md`: this setup, contract, licensing and operational record.

Modified:
- `src/server.ts`: mount routes and start maintenance after existing Mongo connection succeeds.
- `.env.example`: document the provider key and optional controls. Existing deployment files/dependencies are unchanged.
