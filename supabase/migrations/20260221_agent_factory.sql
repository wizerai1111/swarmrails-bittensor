-- =============================================================================
-- MIGRATION: agent_factory
-- VERSION:   20260221
-- PURPOSE:   Provision the shared_services.provision_new_agent() function.
--            A single RPC call creates an isolated agent schema, its standard
--            tables (agent_logs, memory), RLS policies, grants, and registers
--            the agent in the Master Registry — all in one atomic transaction.
--
-- DEPENDS ON: 20260221020053_create_shared_services.sql (shared_services schema)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PGVECTOR EXTENSION (required for memory.embedding column)
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;


-- -----------------------------------------------------------------------------
-- 2. PROVISION FUNCTION
--
-- Placed in the `public` schema so Supabase PostgREST exposes it as an RPC
-- endpoint without additional config.  SECURITY DEFINER lets the function run
-- with owner (postgres) privileges so it can CREATE SCHEMA dynamically.
-- The explicit search_path prevents search_path-injection attacks.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provision_new_agent(
    p_agent_id     TEXT,
    p_display_name TEXT,
    p_schema_name  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, shared_services, extensions
AS $$
DECLARE
    v_schema_exists BOOLEAN;
    v_agent_exists  BOOLEAN;
BEGIN

    -- -------------------------------------------------------------------------
    -- A. INPUT VALIDATION
    -- -------------------------------------------------------------------------

    IF trim(coalesce(p_agent_id, ''))     = '' THEN
        RAISE EXCEPTION 'INVALID_INPUT: p_agent_id cannot be empty.';
    END IF;
    IF trim(coalesce(p_display_name, '')) = '' THEN
        RAISE EXCEPTION 'INVALID_INPUT: p_display_name cannot be empty.';
    END IF;
    IF trim(coalesce(p_schema_name, ''))  = '' THEN
        RAISE EXCEPTION 'INVALID_INPUT: p_schema_name cannot be empty.';
    END IF;

    -- Enforce naming convention: must start with "agent_"
    IF p_schema_name NOT LIKE 'agent\_%' ESCAPE '\' THEN
        RAISE EXCEPTION
            'INVALID_SCHEMA_NAME: Schema name must begin with "agent_". Got: "%".',
            p_schema_name;
    END IF;

    -- -------------------------------------------------------------------------
    -- B. IDEMPOTENCY GUARDS — fail fast with a clear error before touching DDL
    -- -------------------------------------------------------------------------

    SELECT EXISTS(
        SELECT 1 FROM shared_services.projects WHERE agent_id = p_agent_id
    ) INTO v_agent_exists;

    IF v_agent_exists THEN
        RAISE EXCEPTION
            'AGENT_EXISTS: agent_id "%" is already registered in shared_services.projects.',
            p_agent_id;
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM information_schema.schemata WHERE schema_name = p_schema_name
    ) INTO v_schema_exists;

    IF v_schema_exists THEN
        RAISE EXCEPTION
            'SCHEMA_EXISTS: Schema "%" already exists. Choose a different schema name.',
            p_schema_name;
    END IF;

    -- -------------------------------------------------------------------------
    -- C. CREATE ISOLATED SCHEMA
    -- -------------------------------------------------------------------------

    EXECUTE format('CREATE SCHEMA %I', p_schema_name);

    EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role',   p_schema_name);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated',  p_schema_name);

    -- -------------------------------------------------------------------------
    -- D. CREATE agent_logs TABLE
    --    Structured log sink for all activity in this agent's workflow.
    -- -------------------------------------------------------------------------

    EXECUTE format($sql$
        CREATE TABLE %I.agent_logs (
            id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            level      TEXT        NOT NULL DEFAULT 'info'
                            CHECK (level IN ('debug', 'info', 'warn', 'error')),
            message    TEXT        NOT NULL,
            metadata   JSONB
        )
    $sql$, p_schema_name);

    EXECUTE format(
        'CREATE INDEX ON %I.agent_logs (created_at DESC)',
        p_schema_name
    );
    EXECUTE format(
        'CREATE INDEX ON %I.agent_logs (level)',
        p_schema_name
    );

    -- -------------------------------------------------------------------------
    -- E. CREATE memory TABLE
    --    Vector store for long-term agent memory and RAG retrieval.
    --    Requires pgvector (enabled above).
    -- -------------------------------------------------------------------------

    EXECUTE format($sql$
        CREATE TABLE %I.memory (
            id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            content    TEXT        NOT NULL,
            embedding  vector(1536),           -- OpenAI text-embedding-3-small
            metadata   JSONB
        )
    $sql$, p_schema_name);

    -- HNSW index for fast approximate nearest-neighbour searches.
    EXECUTE format(
        'CREATE INDEX ON %I.memory USING hnsw (embedding vector_cosine_ops)',
        p_schema_name
    );

    -- -------------------------------------------------------------------------
    -- F. ENABLE RLS + GRANT PRIVILEGES
    -- -------------------------------------------------------------------------

    EXECUTE format('ALTER TABLE %I.agent_logs ENABLE ROW LEVEL SECURITY', p_schema_name);
    EXECUTE format('ALTER TABLE %I.memory     ENABLE ROW LEVEL SECURITY', p_schema_name);

    -- service_role: full access (Edge Functions, pg_cron jobs)
    EXECUTE format($sql$
        CREATE POLICY "service_role_all"
            ON %I.agent_logs AS PERMISSIVE FOR ALL
            TO service_role USING (true) WITH CHECK (true)
    $sql$, p_schema_name);

    EXECUTE format($sql$
        CREATE POLICY "service_role_all"
            ON %I.memory AS PERMISSIVE FOR ALL
            TO service_role USING (true) WITH CHECK (true)
    $sql$, p_schema_name);

    -- Ensure future tables in this schema are also covered.
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO service_role',
        p_schema_name
    );
    EXECUTE format(
        'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I TO service_role',
        p_schema_name
    );

    -- -------------------------------------------------------------------------
    -- G. REGISTER IN MASTER REGISTRY
    -- -------------------------------------------------------------------------

    INSERT INTO shared_services.projects (agent_id, schema_name, display_name)
    VALUES (p_agent_id, p_schema_name, p_display_name);

    -- -------------------------------------------------------------------------
    -- H. RETURN MANIFEST
    -- -------------------------------------------------------------------------

    RETURN jsonb_build_object(
        'success',        true,
        'agent_id',       p_agent_id,
        'display_name',   p_display_name,
        'schema_name',    p_schema_name,
        'tables_created', jsonb_build_array('agent_logs', 'memory'),
        'indexes_created', jsonb_build_array(
            p_schema_name || '.agent_logs(created_at DESC)',
            p_schema_name || '.agent_logs(level)',
            p_schema_name || '.memory HNSW cosine'
        )
    );

EXCEPTION
    WHEN OTHERS THEN
        -- If schema was created before the failure, roll it back atomically.
        -- Because this is inside a single transaction, Postgres will undo all
        -- DDL automatically on RAISE — no manual cleanup needed here.
        -- We re-raise to propagate the original error message to the caller.
        RAISE;
END;
$$;

-- Revoke public execute — only service_role and postgres should call this.
REVOKE EXECUTE ON FUNCTION public.provision_new_agent(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.provision_new_agent(TEXT, TEXT, TEXT) TO service_role;


-- =============================================================================
-- DOWN MIGRATION (rollback — run manually if needed)
-- =============================================================================
-- DROP FUNCTION IF EXISTS public.provision_new_agent(TEXT, TEXT, TEXT);
-- DROP EXTENSION IF EXISTS vector;
--
-- NOTE: Individual agent schemas created by this function are NOT dropped here.
-- To deprovision a specific agent, run:
--   DROP SCHEMA agent_<name> CASCADE;
--   DELETE FROM shared_services.projects WHERE agent_id = '<id>';
