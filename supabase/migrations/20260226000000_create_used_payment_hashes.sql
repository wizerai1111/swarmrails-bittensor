-- =============================================================================
-- MIGRATION: create_used_payment_hashes
-- VERSION:   20260226000000
-- PURPOSE:   Replay-protection store for x402 Base blockchain tx hashes.
--            Each hash can only be spent once within a 10-minute TTL window.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.used_payment_hashes (
    tx_hash     TEXT        PRIMARY KEY,
    used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-expire rows older than 10 minutes via pg_cron (low cardinality table)
-- TTL cleanup: called once per minute by pg_cron (configured separately)
CREATE INDEX IF NOT EXISTS idx_used_hashes_used_at ON public.used_payment_hashes (used_at DESC);

-- service_role: full access (Edge Functions read/write)
ALTER TABLE public.used_payment_hashes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_used_hashes"
    ON public.used_payment_hashes
    AS PERMISSIVE FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
