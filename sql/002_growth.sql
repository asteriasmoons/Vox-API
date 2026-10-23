-- Additive migration for autonomous expansion and source provenance.
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS refresh_after timestamptz NOT NULL DEFAULT now();
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS expansion_depth int NOT NULL DEFAULT 0;
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS expanded_at timestamptz;
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS popularity real NOT NULL DEFAULT 0;
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS author_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS tag_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS provider_ids jsonb NOT NULL DEFAULT '{}';
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS title_variants text[] NOT NULL DEFAULT '{}';
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS cover_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE bk_works ADD COLUMN IF NOT EXISTS source_names text[] NOT NULL DEFAULT '{}';
ALTER TABLE bk_editions ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE bk_editions ADD COLUMN IF NOT EXISTS provider_edition_id text;
ALTER TABLE bk_editions ADD COLUMN IF NOT EXISTS cover_url text;
CREATE UNIQUE INDEX IF NOT EXISTS bk_edition_source_idx ON bk_editions(provider,provider_edition_id) WHERE provider_edition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bk_refresh_idx ON bk_works(refresh_after);
CREATE INDEX IF NOT EXISTS bk_expand_idx ON bk_works(expanded_at,expansion_depth);
CREATE INDEX IF NOT EXISTS bk_work_authors_author_idx ON bk_work_authors(author_id);
CREATE INDEX IF NOT EXISTS bk_work_subjects_subject_idx ON bk_work_subjects(subject_id);
CREATE INDEX IF NOT EXISTS bk_related_to_idx ON bk_related(to_work);
CREATE INDEX IF NOT EXISTS bk_provider_ids_work_idx ON bk_provider_ids(work_id);
ALTER TABLE bk_jobs ADD COLUMN IF NOT EXISTS last_heartbeat timestamptz;
CREATE TABLE IF NOT EXISTS bk_source_observations (
 provider text NOT NULL, provider_id text NOT NULL, work_id uuid NOT NULL REFERENCES bk_works(id) ON DELETE CASCADE,
 observed_at timestamptz NOT NULL DEFAULT now(), attribution text, raw_digest text,
 PRIMARY KEY(provider,provider_id)
);
CREATE TABLE IF NOT EXISTS bk_runtime_state (name text PRIMARY KEY, last_run timestamptz, value jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS bk_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
