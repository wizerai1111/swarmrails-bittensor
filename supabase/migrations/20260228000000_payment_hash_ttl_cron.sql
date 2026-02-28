-- =============================================================================
-- MIGRATION: payment_hash_ttl_cron
-- VERSION:   20260228000000
-- PURPOSE:   Schedule a pg_cron job to purge expired replay-protection hashes
--            from public.used_payment_hashes every 5 minutes.
--            Rows older than 10 minutes are outside the replay-protection
--            window and no longer need to be stored.
-- =============================================================================

-- 1. Enable pg_cron (idempotent — no-op if already active)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;

-- 2. Remove any previous version of this job before rescheduling
SELECT cron.unschedule('swarmrails_payment_hash_ttl')
WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'swarmrails_payment_hash_ttl'
);

-- 3. Schedule cleanup every 5 minutes
SELECT cron.schedule(
    'swarmrails_payment_hash_ttl',
    '*/5 * * * *',
    $$
    DELETE FROM public.used_payment_hashes
    WHERE used_at < NOW() - INTERVAL '10 minutes';
    $$
);


-- =============================================================================
-- VERIFY (run manually after applying):
--   SELECT jobname, schedule, active FROM cron.job
--   WHERE jobname = 'swarmrails_payment_hash_ttl';
--
-- DOWN MIGRATION:
--   SELECT cron.unschedule('swarmrails_payment_hash_ttl');
-- =============================================================================
