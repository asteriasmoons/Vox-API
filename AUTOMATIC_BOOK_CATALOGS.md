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

Generation continues in this existing Express process, using the existing Mongo feature cache and owner-checked lease for cross-worker deduplication. No new backend, queue, database, or worker service is introduced. Jobs have a five-minute overall deadline; individual HTTP progress calls return promptly, and discovery page requests have a twelve-second timeout without repeated retries. The larger-page recovery request has at least twelve seconds. Full record reads retain their 15-second timeout and one retry. Process restarts leave only expiring snapshots/leases, not permanent jobs or personal input profiles.

Book signals: local opaque ID, title, author, ISBN, existing genres/topics, rating, favorite flag, reading status, and an aggregate of recent pages/minutes. No session notes, review text, email, or name is sent. Books are capped at 1,000 per request with validation, not silently truncated. The app uses the same backend host as the existing features.

## Actual provider contract

Sources inspected before implementation:

- [Documentation](https://bookdatabase.io/documentation)
- [OpenAPI v1](https://bookdatabase.io/api/v1.yaml)
- [Published plans](https://bookdatabase.io/)
- [Terms, sections 7 and 9](https://bookdatabase.io/terms-of-service)

`/books` are works; `/editions` carry ISBNs, page counts, publishers and genres. Subjects and author references belong to works. Both `_link` (OpenAPI spelling) and `_links` (live response spelling) are supported. Pagination follows the supplied next link, not guessed numeric pages. Provider redirects are never followed with the API key. All HAL links are restricted to the documented HTTPS API origin and `/v1/` path. Returned resource IDs, search criteria and requested relationships are checked to reject responses that do not honor the request.

The live provider can reject its own next link with `INVALID_FORMAT_CONTINUATION_TOKEN`. In that specific case, a single larger first-page request uses the same documented filters and a page size bounded by the original discovery budget and the provider's maximum of 100. Already-seen records are removed. No token is synthesized, and a failed recovery preserves previous results and reports a partial response.

There is no documented direct book-to-book recommendation edge, author-similarity API, genre name search, subject name search, or publication-year field on this edition schema. We do not invent any. Related Books is inferred from multiple shared subjects/genres, not advertised as an explicit publisher/provider relation. New authors are authors of matching works, not a fabricated author-relationship graph. Publication year remains absent when unavailable.

English-only recommendations are verified through edition language relationships. The English resource ID is learned from `/languages/{id}` with `iso639Code: "eng"`, or the documented paginated `/languages` collection, and cached temporarily. It is not hardcoded. `/books` does not accept a language filter. Genre discovery uses `/editions?genreId=...&languageId=...`; author and subject discovery use `/books?authorId=...` and `/books?subjectId=...`, then validate linked editions individually. If a compound edition query fails, the documented single-filter edition query is used with the identical mandatory language validation. Foreign and unknown-language editions never qualify. Display titles, ISBNs, pages, publishers and images come from the verified English edition, not an arbitrary translation's work title or cover.

## Matching and ranking

ISBN-13/10 are checked, ISBN-10 can be canonically compared to ISBN-13, and editions resolve to works. A conflicting title/author or edition-to-work relationship is not accepted solely because an ISBN matched. Fallback is normalized exact title and author, using both the work-title index and the separately documented edition-title index; ambiguous work matches are excluded rather than guessed. Loomey's current Book model has no compatible stored provider work ID or Google/Open Library identifier, so none is fabricated or migrated into it.

Only books with reading status `Finished` drive source matching, genre/subject preferences and recommendation ranking. Favorites, high ratings and recent activity prioritize those finished books, with distinct authors represented first. The existing exclusion of ratings below three remains. Reading, TBR, DNF, archived and all other library records remain ownership exclusions, never positive recommendation signals. The full library is still submitted so these exclusions are reliable; no reading status or stored book metadata is modified.

Up to 36 finished sources are considered to obtain at most twelve matched works. The first twelve source attempts use the documented ISBN and strict title/author paths. Later attempts are ISBN-only, allowing a valid later finished book to match without spending the entire budget on broken title searches. If provider title matching fails, real specific genres/subjects on finished library books can still rank verified English candidates. A bounded documented `/editions?languageId=...` plan provides candidates for this fallback; only actual metadata overlap qualifies, and actual returned matching genre IDs can add targeted genre plans. This is not a genre-name search or an unrestricted catalog copy.

Discovery pages request `includeRelationships=None` and stream HAL pages as they arrive. Candidate IDs are then resolved to full work and English edition records with `includeRelationships=All`; this changes when data is fetched, not which metadata fields or catalog types are supported. Up to eight linked editions are checked for an English match; work-filtered edition pages are a fallback when edition references are absent or additional editions remain unchecked. A later page or relationship outage does not erase earlier verified results. Each matched finished book can publish a preview before matching continues. When the rotated preview category is absent, its available author query is used instead of skipping that book. A preview stops after two accepted books; remaining pages can be resumed later. Broad profile discovery is used only when no finished source matches; successful source relationships retain priority. Subsequent genre/author plans run before subject queries in each interleaved pass, with duplicate work enrichment avoided during the job.

Specific genres score 3, subjects 5, same author 4, and a genre-plus-subject combination adds 5. Very broad classifications such as Fiction, General and Literature do not score. Counts are capped to prevent metadata-rich records from dominating. Strongest matches rank first with deterministic ID tie breaks. All existing library identities, source works, duplicate work IDs, ISBN equivalents and title/author duplicates are excluded. Catalog allocation also prevents repetition across rows.

Catalog types are similar books, favorite genres, similar themes, new authors, familiar authors, related books and broader discovery. Each row requires at least two qualifying records and includes at most six. Allocation reserves the two-book minimum for viable sections before filling longer rows, preventing the first broad section from consuming all candidates. Missing categories are omitted, never filled with unrelated books. Candidate expansion is bounded to 24 distinct metadata plans, up to three pages of twelve results, and 64 candidate work enrichments, not an unrestricted crawl. Each seed can supply two authors, two specific genres and three specific subjects. Cold generation can take time under the one-per-second plan, but progressive HTTP calls return promptly and already available rows are shown before generation finishes. All seven catalog types remain supported.

## Caching, quota and outages

- Existing MongoDB/Mongoose infrastructure stores only expiring feature-specific documents, not a permanent catalog mirror.
- Metadata TTL is six hours by default, never more than 24 hours; negative lookups last 15 minutes; image URLs last four minutes because provider URLs are valid for five.
- Personalized outputs last one hour, or five minutes when partial. Cache keys hash the complete normalized library input, including local opaque book IDs, so library/rating/status/reading changes invalidate output. No raw personal input profile is persisted.
- Identical fetches coalesce in-process and through owner-checked Mongo leases across workers.
- Cached catalog responses do not wait for a random-book request. The existing periodic maintenance still checks provider access every 15 minutes.
- Atomic Mongo rate reservations enforce at least 1,100 ms between provider request starts across all workers, including midnight. A durable UTC daily counter caps requests at 5,000 even after a restart. Conservative reservations count failed calls too; the provider may refund 5xx against its own count.
- Timeouts and 5xx receive one bounded retry, with a new rate/quota reservation. Auth/quota/invalid-record errors are not blindly retried. Missing records are negative-cached. Provider responses are validated before caching.
- Requests are rate-limited by server-observed client address independently of the shared subscription budget. Catalog/data requests allow 20 per minute, progressive status requests 40 per minute, and image resolution 90 per minute. Existing proxy configuration is unchanged; clients sharing a server-observed proxy address share that limit. Health checks run every 15 minutes and use the same cached/rate-limited client, consuming at most about 96 daily calls.
- Provider `NO_API_CALLS_REMAINING` (documented HTTP 400) and HTTP 429 are handled explicitly with retry information. Access-denied responses purge provider-derived caches. Mongo outages fail closed rather than bypassing quota controls.
- iOS stores catalog responses and cover bytes only in bounded, expiring memory caches. No catalog credentials are stored. Offline unexpired responses can be reused; other offline/error/empty states offer retry.
- Finished-only output uses the versioned `catalog-v11-finished-profile` key, so previous mixed-status catalogs/job snapshots are not reused. The app uses a corresponding `finished-v3` memory-cache prefix and retains English validation. Existing user data is untouched.

## Diagnostics

Search Railway logs for `[LoomeyCatalog]`. JSON events record HTTP status/latency, job trace IDs, finished/eligible/source-lookup counts, finished-only specific genre/subject counts, seed matching outcomes, author/genre/subject query filters, provider pages, relationship/language rejections, candidate counts, per-section ranking and failures. The app sends `X-Loomey-Catalog-Trace`, echoed in responses; `traceID` in job snapshots identifies the generation job even if another HTTP poll reads it. Frontend console events use the same prefix for network calls, polling, applied sections, retries, detail selection, and image request/cache/decode results. No API keys, reader titles, ISBNs, session text, signed image URLs or raw personalized request bodies are logged. Provider search/ISBN/continuation-token parameter values are redacted.

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

### English-only correction, 2026-10-23

The earlier result was not English-validated; Dutch titles exposed a missing language check. The corrected current-source HTTP test, using the real provider and existing Mongo temporary metadata cache with one public Dune library signal, returned HTTP 202 in 578 ms, two populated sections on the 4.7-second poll, and nine distinct verified English books at completion in 13.1 seconds. English titles included The Jesus incident, The robot brains, Accelerando and Tyrant's Test. All nine had actual English edition language relationships; foreign editions were rejected. The run explicitly reported partial data because a subject request failed and the provider's own continuation link was rejected. The subsequent documented larger-page recovery was tested live and returned 35 unique author works rather than stopping at twelve. Those discovery works still undergo English verification before display. These timings use some warm provider caches and are not a cold-start guarantee or device UI verification.

The updated deterministic suite passes 39 tests, including English ID resolution, language rejection, edition-title/cover precedence, twelve-source coverage, author/genre/subject plans, all seven viable sections, fallback queries, pagination recovery and diagnostic redaction. `tsc --noEmit` passes. Swift contracts were updated but no app build, compiled Swift test harness, launch or deployment was run for this correction. Device UI and the deployed Railway revision remain unverified.

### Finished-only matching and failure trace, 2026-10-23

The supplied Railway trace `C22254CB-F923-4F7D-AA0F-E17D4320F005` proves the provider key and Mongo connection were working: ISBN/author requests returned HTTP 200. Most title queries returned unrelated records and were correctly rejected. Only two source works matched; neither carried genre IDs, and the rotated second preview incorrectly skipped its available author query. Subsequent subject queries hit the old 6.5-second timeout, leaving zero qualifying candidates. Rechecking the documented subject query with a twenty-second allowance also timed out, so increasing the timeout alone is not claimed as a solution.

The current correction uses Finished-only sources/preferences, considers later finished ISBNs, retains strict identity/English checks, falls back to available source relationships for previews, and keeps successful matching ahead of broad profile fallback. A real current-source check using the two publicly identified matching works, their actual metadata and a Reading-status control matched exactly two Finished sources and returned five distinct verified English recommendations. The first two were published after 877 ms using warm temporary metadata caches. The diagnostic used a shortened 35-second overall deadline; the final result retained all five books and reported `partial: true` because upstream subject/pagination work was unavailable or interrupted. Production retains its five-minute deadline. This is not a cold-start guarantee, a test of the user's full ninety-book input, or deployed/device verification.

All 45 deterministic backend tests pass, including Finished-only source selection/ranking, no positive discovery from unfinished books, full-library ownership exclusion, later ISBN attempts, profile fallback and missing-genre author preview ordering. `tsc --noEmit` and `git diff --check` pass. No app build, compiled Swift harness, app launch or deployment was run. Railway connector/CLI access requires reauthentication, so the deployed revision has not been updated or verified here.

Files changed for this follow-up:

| File | Why |
| --- | --- |
| `src/services/automaticCatalogService.ts` | Finished-only matching/preferences, later ISBN rescue, actual-metadata fallback, earlier author results and corrected cache/diagnostic counts. |
| `src/services/bookDatabaseClient.ts` | Preserve the pending bounded twelve-second allowance for documented larger-page pagination recovery. |
| `tests/automatic-catalogs.test.mjs` | Six additional regressions for source status, ranking, exclusions, fallback and scheduling; generation fixtures now explicitly mark Finished sources. |
| `AUTOMATIC_BOOK_CATALOGS.md` | Document the rule, actual failure evidence, limitations and verification boundary. |

## Correction file changes

| File | Change |
| --- | --- |
| `src/services/bookDatabaseClient.ts` | Language resource parsing/validation, request-level bounds, HAL pagination recovery and provider request/response diagnostics. |
| `src/services/automaticCatalogService.ts` | Verified English edition selection, broader personalized discovery, balanced query scheduling/section allocation, versioned cache invalidation and generation diagnostics. |
| `src/services/catalogDiagnostics.ts` | Structured trace logging with credential, ISBN, search and continuation-token redaction. |
| `src/routes/automaticCatalogs.ts` | Trace correlation, endpoint diagnostics and a separate progressive polling rate-limit bucket. |
| `tests/automatic-catalogs.test.mjs` | English, broader discovery, fallback, allocation, pagination and logging regression coverage; existing tests updated for verified editions. |
| `AUTOMATIC_BOOK_CATALOGS.md` | Current contracts, limits, fallback behavior, live evidence and verification boundaries. |

No Collections, app authentication, reading history, other providers or unrelated backend services were edited for this correction.

## Backend file manifest

New:
- `src/services/bookDatabaseClient.ts`: documented API, HAL, validation, request coalescing and temporary cache access.
- `src/services/automaticCatalogStore.ts`: feature-only Mongo TTL caches, leases, quota/rate controls and purge.
- `src/services/automaticCatalogService.ts`: library validation, reliable matching, ranking and catalog allocation.
- `src/services/catalogLibraryMetadata.ts`: independent metadata for permanent library saves, no AI.
- `src/services/catalogDiagnostics.ts`: structured, redacted provider and catalog diagnostics.
- `src/services/automaticCatalogMaintenance.ts`: existing-process periodic access checks and disabled-state cleanup.
- `src/routes/automaticCatalogs.ts`: sign-in-free feature routes, per-address throttling and consistent safe errors.
- `scripts/purge-automatic-catalogs.mjs`: operator cleanup of feature caches only.
- `tests/automatic-catalogs.test.mjs`: deterministic feature coverage.
- `AUTOMATIC_BOOK_CATALOGS.md`: this setup, contract, licensing and operational record.

Modified:
- `src/server.ts`: mount routes and start maintenance after existing Mongo connection succeeds.
- `.env.example`: document the provider key and optional controls. Existing deployment files/dependencies are unchanged.
