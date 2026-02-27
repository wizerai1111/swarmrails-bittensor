-- =============================================================================
-- MIGRATION: fix_gateway_jobs_updated_at
-- VERSION:   20260226000001
-- PURPOSE:   Add missing updated_at column to gateway_jobs table.
--            The table was created without it but a trigger references it.
-- =============================================================================

ALTER TABLE public.gateway_jobs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Back-fill existing rows
UPDATE public.gateway_jobs SET updated_at = created_at WHERE updated_at = NOW() AND created_at < NOW();
