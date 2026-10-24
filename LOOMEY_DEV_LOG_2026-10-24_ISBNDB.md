# Loomey / Vox API Development Log — October 24, 2026 (ISBNdb)

## Goal
Add ISBNdb Basic trial as a fourth provider to the existing Vox API book knowledge worker.

## Local changes
- Added `src/services/loomeyRecommendations/providers/isbnDb.ts` for ISBNdb search, ISBN lookup, normalization, and authentication via `ISBNDB_API_KEY`.
- Registered ISBNdb in `src/bookKnowledge/worker.ts` with a per-job request budget of two.
- Added `isbndb` to provider names, source ordering, and knowledge-query provider extraction.
- Configured a conservative initial transport ceiling of 100 requests/day and 1200 ms spacing; actual Basic plan quota should be verified before increasing.

## Verification
- `npm run build` passed.
- `git diff --check` passed.
- No live ISBNdb API request, knowledge worker execution, Railway deployment, or GitHub push performed.
- API response compatibility, Basic-tier endpoint access, and actual ingestion remain unverified.

## Follow-up
With user permission, perform a narrowly scoped API check, then validate worker ingestion and plan quota. Preserve existing providers and avoid running the full worker without explicit request.

## Live ISBNdb verification (same day)
- User independently confirmed a Basic trial `/books/fiction?page=1&pageSize=2` search returned HTTP 200 and two books.
- A subsequent local Mac test using the compiled ISBNdb normalizer and one live API request returned HTTP 200 and two records.
- Both records were accepted with title, author, ISBN, cover, English language, and publication year (2021 and 2023).
- No database writes, full worker runs, deployment, or push were performed.
- Still unverified: real worker ingestion, single-book endpoint, and full provider behavior under worker budgets.

## Controlled PostgreSQL ingestion verification
- Updated local `BOOK_KNOWLEDGE_DATABASE_URL` to a publicly reachable Railway TCP-proxy connection (user-provided change; credentials not logged).
- Verified connectivity with `SELECT 1` from the Mac.
- Requested two ISBNdb fiction results, normalized the eligible results, and ingested exactly one via `ingestProviderBook`.
- Queried `bk_works` and `bk_provider_ids` afterward; record existed, title matched, and ISBNdb provider link was present. The test exited successfully (code 0).
- No full worker execution, GitHub push, Railway deployment, or Loomey iOS modifications.
