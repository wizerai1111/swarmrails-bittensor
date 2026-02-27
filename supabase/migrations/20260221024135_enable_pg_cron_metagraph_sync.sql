-- =============================================================================
-- MIGRATION: enable_pg_cron_metagraph_sync
-- VERSION:   20260221024135
-- PURPOSE:   Enable the pg_cron and pg_net extensions, then schedule a daily
--            job that calls the metagraph_sync Edge Function via HTTP.
--            This replaces any need for an external Python cron server.
--
-- PREREQUISITES:
--   • pg_cron must be enabled in your Supabase project dashboard under
--     Database → Extensions before running this migration.
--   • pg_net is enabled by default on all Supabase projects.
--   • The metagraph_sync Edge Function must be deployed first.
--
-- APPLY:  supabase db push   (once the function is deployed)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ENABLE EXTENSIONS
-- -----------------------------------------------------------------------------

-- pg_net: non-blocking HTTP from inside Postgres (ships with Supabase by default).
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- pg_cron: cron-style job scheduler inside Postgres.
-- Must also be toggled ON in the Supabase dashboard (Database → Extensions).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Grant cron usage to the postgres role (required by pg_cron).
GRANT USAGE ON SCHEMA cron TO postgres;


-- -----------------------------------------------------------------------------
-- 2. HELPER: store the Edge Function URL in a config table so it can be
--    updated without editing SQL.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shared_services.sync_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shared_services.sync_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_sync_config"
    ON shared_services.sync_config
    AS PERMISSIVE FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Seed the function URL and service key references.
-- Replace the placeholder values with your actual project ref and service key.
INSERT INTO shared_services.sync_config (key, value) VALUES
    ('metagraph_sync_url',
     'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/metagraph_sync'),
    ('metagraph_sync_key',
     '<YOUR_SERVICE_ROLE_KEY>')
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 3. PG_CRON JOB: run metagraph_sync every 24 hours at 02:00 UTC
-- -----------------------------------------------------------------------------

-- Remove any pre-existing job with this name to make the migration idempotent.
SELECT cron.unschedule('swarmrails_metagraph_daily_sync')
WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'swarmrails_metagraph_daily_sync'
);

-- Schedule the job using NAMED dollar-quoting to avoid nesting errors
SELECT cron.schedule(
    'swarmrails_metagraph_daily_sync',
    '0 2 * * *',
    $job$
    DO $inner$
    DECLARE
        v_url  TEXT;
        v_key  TEXT;
    BEGIN
        SELECT value INTO v_url
        FROM shared_services.sync_config
        WHERE key = 'metagraph_sync_url';

        SELECT value INTO v_key
        FROM shared_services.sync_config
        WHERE key = 'metagraph_sync_key';

        -- Use the retrieved values to trigger the sync
        IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
            PERFORM net.http_post(
                url     := v_url,
                headers := jsonb_build_object(
                    'Content-Type',  'application/json',
                    'Authorization', 'Bearer ' || v_key
                ),
                body    := '{}'::jsonb
            );
        END IF;
    END $inner$;
    $job$
);


-- -----------------------------------------------------------------------------
-- 4. VERIFY
-- -----------------------------------------------------------------------------

-- After applying, confirm the job was registered:
--   SELECT jobname, schedule, active FROM cron.job;


-- =============================================================================
-- DOWN MIGRATION (rollback — run manually if needed)
-- =============================================================================
-- SELECT cron.unschedule('swarmrails_metagraph_daily_sync');
-- DROP TABLE IF EXISTS shared_services.sync_config;
-- DROP EXTENSION IF EXISTS pg_cron;
-- DROP EXTENSION IF EXISTS pg_net;
