# Loomey automatic book catalogs

## Configuration and deployment

This feature extends this existing Express/MongoDB service. There is no second backend.

Required: `BOOKDATABASE_API_KEY` in the existing host's secrets/environment and the existing `MONGODB_URI`.
The key is already present in the local `.env`; it is not copied into app source, responses, logs, or documentation.
Deploy the updated backend using the existing `npm run build` / `npm start` or Docker workflow before shipping the iOS change.

Optional configuration:

- `BOOKDATABASE_DISABLED=true`: disable all provider reads, purge temporary catalogs at startup and maintenance, and reject catalog data requests.
- `BOOKDATABASE_SUBSCRIPTION_EXPIRES_AT`: optional ISO paid-through bound. Not required. Without it, provider access is revalidated every 15 minutes.
- `LOOMEY_APPLE_AUDIENCE`: defaults to the existing app bundle ID, `im.lystaria.Lumey`.

New catalogs require authenticated Apple Sign In. Existing Loomey sign-in records contain an Apple subject but no backend-verifiable token. Existing users may therefore see an Apple Continue button in the catalog section once. New sign-ins retain Apple's short-lived identity token in Keychain only until it can be exchanged. The backend validates Apple signature/issuer/audience, then issues a scoped 30-day session. The signing key is domain-separated from the provider secret using HMAC; rotating the provider key invalidates these sessions. Nothing embeds the provider credential in iOS. Existing user/library/Collections APIs are unchanged.

## Endpoints

All responses are `private, no-store`. All routes except the session exchange require the scoped bearer token. User identity comes exclusively from the verified token, never a submitted user ID.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/books/automatic-catalogs/session` | Exchange `{ identityToken }` for `{ token, userID }`. |
| POST | `/api/books/automatic-catalogs` | Accept `{ books: [...] }`, return expiring personalized catalogs. |
| GET | `/api/books/automatic-catalogs/books/:id` | Full metadata for a provider work and a compatible edition. |
| GET | `/api/books/automatic-catalogs/books/:id/library-metadata` | Independently sourced Google Books/Open Library metadata suitable for saving to the user's library. |
| GET | `/api/books/automatic-catalogs/images/:id` | Resolve the documented 302 image-content endpoint without forwarding the provider key to the image host/app. |

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

Specific genres score 3, subjects 5, same author 4, and a genre-plus-subject combination adds 5. Very broad classifications such as Fiction, General and Literature do not score. Counts are capped to prevent metadata-rich records from dominating. Strongest matches rank first with deterministic ID tie breaks. All existing library identities, source works, duplicate work IDs, ISBN equivalents and title/author duplicates are excluded. Catalog allocation also prevents repetition across rows.

Catalog types are similar books, favorite genres, similar themes, new authors, familiar authors, related books and broader discovery. Each row requires at least two qualifying records and includes at most six. Missing categories are omitted, never filled with unrelated books. Candidate expansion is bounded to eight metadata queries, up to two pages each and 22 candidate work enrichments, not an unrestricted crawl. Cold requests may take tens of seconds under the one-per-second plan; later requests reuse the legitimate caches.

## Caching, quota and outages

- Existing MongoDB/Mongoose infrastructure stores only expiring feature-specific documents, not a permanent catalog mirror.
- Metadata TTL is six hours by default, never more than 24 hours; negative lookups last 15 minutes; image URLs last four minutes because provider URLs are valid for five.
- Personalized outputs last one hour, or five minutes when partial. Cache keys hash the verified subject and complete normalized input, so library/rating/status/reading changes invalidate output. No raw personal input profile is persisted.
- Identical fetches coalesce in-process and through owner-checked Mongo leases across workers.
- Atomic Mongo rate reservations enforce at least 1,100 ms between provider request starts across all workers, including midnight. A durable UTC daily counter caps requests at 5,000 even after a restart. Conservative reservations count failed calls too; the provider may refund 5xx against its own count.
- Timeouts and 5xx receive one bounded retry, with a new rate/quota reservation. Auth/quota/invalid-record errors are not blindly retried. Missing records are negative-cached. Provider responses are validated before caching.
- User requests are rate-limited independently of the shared subscription budget. Health checks run every 15 minutes and use the same cached/rate-limited client, consuming at most about 96 daily calls.
- Provider `NO_API_CALLS_REMAINING` (documented HTTP 400) and HTTP 429 are handled explicitly with retry information. Access-denied responses purge provider-derived caches. Mongo outages fail closed rather than bypassing quota or auth.
- iOS stores catalog responses and cover bytes only in bounded, expiring memory caches. Auth/session credentials use existing Keychain conventions. Offline unexpired responses can be reused; other offline/error/empty states offer retry.

## Subscription cancellation

The terms permit temporary caching while subscribed and require removing stored/cached provider data when access ends. No renewal date is required by this implementation. Provider access checks detect denial within a maintenance interval, but the API does not document a subscription-status webhook or endpoint. If cancelling, set `BOOKDATABASE_DISABLED=true` and restart all backend workers; do not wait for a failing provider call. For immediate cleanup after disabling:

```sh
npm run build
node scripts/purge-automatic-catalogs.mjs
```

Only AutomaticCatalogCache is purged. Collections, user libraries, reading history, and existing recommendation shelves are not touched. The app's temporary catalog data expires; independently verified Google/Open Library data saved to a user's library is not provider-owned catalog content and is retained. New library saves never fall back to bookdatabase.io descriptions/pages/classifications if independent metadata is unavailable.

## Verification and live limitation

The deterministic suite is `npm run build && node --test tests/automatic-catalogs.test.mjs`. It covers HAL parsing/pagination, link safety, header authentication, ISBN/work matching, conflicting metadata, multi-signal scoring, deduplication, cache TTL and coalescing, cross-worker rate/daily quota controls, errors, auth scope/expiry, and independent library metadata.

On 2026-10-22 local live checks authenticated successfully and read edition/work responses. However, `/books?searchQuery=QzxNoSuchBookTitle88492&pageSize=1&includeRelationships=None` returned a record titled `George Eliot`, despite echoing the nonsense query in `_links.self`. A Fantastic Mr. Fox title query returned the same unrelated George results. The separate documented edition-title search successfully resolved Dune to Frank Herbert, so that fallback is implemented and tested. The subsequent live relationship expansion still failed to produce trustworthy catalog rows; live personalized output remains unverified. Matching/filter checks reject unrelated records rather than treating a 200 response as recommendation success. This behavior needs resolution/clarification from the provider; no invented alternate endpoint or unrelated filler is used. Logs expose stage/error code only, not reader inputs or API credentials.

The broader existing `npm test` suite also reports journal-analysis/provider-split expectation failures in unchanged AI services. Those services and their tests were intentionally not rewritten for this metadata-only feature.

## Backend file manifest

New:
- `src/services/bookDatabaseClient.ts`: documented API, HAL, validation, request coalescing and temporary cache access.
- `src/services/automaticCatalogStore.ts`: feature-only Mongo TTL caches, leases, quota/rate controls and purge.
- `src/services/automaticCatalogService.ts`: library validation, reliable matching, ranking and catalog allocation.
- `src/services/catalogAuth.ts`: Apple verification and scoped sessions using existing jose dependency.
- `src/services/catalogLibraryMetadata.ts`: independent metadata for permanent library saves, no AI.
- `src/services/automaticCatalogMaintenance.ts`: existing-process periodic access checks and disabled-state cleanup.
- `src/routes/automaticCatalogs.ts`: authenticated feature routes and consistent safe errors.
- `scripts/purge-automatic-catalogs.mjs`: operator cleanup of feature caches only.
- `tests/automatic-catalogs.test.mjs`: deterministic feature coverage.
- `AUTOMATIC_BOOK_CATALOGS.md`: this setup, contract, licensing and operational record.

Modified:
- `src/server.ts`: mount routes and start maintenance after existing Mongo connection succeeds.
- `.env.example`: document the provider key and optional controls. Existing deployment files/dependencies are unchanged.
