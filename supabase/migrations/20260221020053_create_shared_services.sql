-- =============================================================================
-- MIGRATION: create_shared_services
-- VERSION:   20260221020053
-- PURPOSE:   Bootstrap the shared_services schema — the global backbone of
--            Swarmrails. Houses the Master Registry (projects), the Subnet
--            Registry, and the unified L402 payment ledger.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SCHEMA
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS shared_services;

-- Grant usage so the authenticated role can resolve object references
GRANT USAGE ON SCHEMA shared_services TO authenticated;
GRANT USAGE ON SCHEMA shared_services TO service_role;


-- -----------------------------------------------------------------------------
-- 2. MASTER REGISTRY: shared_services.projects
--    Maps every registered agent/API to its isolated schema and metadata.
-- -----------------------------------------------------------------------------
CREATE TABLE shared_services.projects (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT        NOT NULL UNIQUE,           -- e.g. "scraper_v1"
    schema_name     TEXT        NOT NULL UNIQUE,           -- e.g. "agent_scraping"
    display_name    TEXT        NOT NULL,
    description     TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shared_services.projects ENABLE ROW LEVEL SECURITY;

-- service_role: full access
CREATE POLICY "service_role_all_projects"
    ON shared_services.projects
    AS PERMISSIVE FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- authenticated: read-only visibility into all active projects
-- (agents need to know which endpoints exist, but cannot mutate the registry)
CREATE POLICY "authenticated_read_active_projects"
    ON shared_services.projects
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (is_active = true);

-- Indexes
CREATE INDEX idx_projects_agent_id    ON shared_services.projects (agent_id);
CREATE INDEX idx_projects_schema_name ON shared_services.projects (schema_name);
CREATE INDEX idx_projects_is_active   ON shared_services.projects (is_active);


-- -----------------------------------------------------------------------------
-- 3. SUBNET REGISTRY: shared_services.subnet_registry
--    Populated and refreshed daily by pg_cron + pg_net from the Bittensor
--    metagraph. Stores live subnet capability metadata for dynamic MCP manifest
--    generation and routing decisions.
-- -----------------------------------------------------------------------------
CREATE TABLE shared_services.subnet_registry (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    netuid          INTEGER     NOT NULL UNIQUE,           -- Bittensor subnet UID
    name            TEXT        NOT NULL,
    description     TEXT,
    capabilities    JSONB       NOT NULL DEFAULT '[]'::JSONB,  -- array of skill tags
    pricing_sat     INTEGER     NOT NULL DEFAULT 0,        -- base price in Satoshis
    endpoint_url    TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    last_synced_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shared_services.subnet_registry ENABLE ROW LEVEL SECURITY;

-- service_role: full access (pg_cron sync jobs run as service_role)
CREATE POLICY "service_role_all_subnet_registry"
    ON shared_services.subnet_registry
    AS PERMISSIVE FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- authenticated: read active subnets (needed for routing lookups)
CREATE POLICY "authenticated_read_active_subnets"
    ON shared_services.subnet_registry
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (is_active = true);

-- Indexes
CREATE INDEX idx_subnet_netuid        ON shared_services.subnet_registry (netuid);
CREATE INDEX idx_subnet_is_active     ON shared_services.subnet_registry (is_active);
CREATE INDEX idx_subnet_capabilities  ON shared_services.subnet_registry USING GIN (capabilities);


-- -----------------------------------------------------------------------------
-- 4. L402 PAYMENT LEDGER: shared_services.api_ledger
--    Every L402 transaction (invoice issued, payment confirmed, tool call
--    executed) is appended here. Source of truth for billing and audit.
-- -----------------------------------------------------------------------------
CREATE TABLE shared_services.api_ledger (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT        NOT NULL
                        REFERENCES shared_services.projects (agent_id)
                        ON DELETE RESTRICT,
    -- L402 / Lightning fields
    payment_hash    TEXT        NOT NULL UNIQUE,           -- Lightning invoice payment hash
    macaroon        TEXT,                                   -- L402 Macaroon (base64)
    amount_sat      INTEGER     NOT NULL CHECK (amount_sat >= 0),
    status          TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
    -- Request context
    tool_name           TEXT,                              -- e.g. "subnet_query"
    request_payload     JSONB,
    response_payload    JSONB,
    -- Timestamps
    invoice_created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_confirmed_at TIMESTAMPTZ,
    expires_at           TIMESTAMPTZ
);

ALTER TABLE shared_services.api_ledger ENABLE ROW LEVEL SECURITY;

-- service_role: full access
CREATE POLICY "service_role_all_ledger"
    ON shared_services.api_ledger
    AS PERMISSIVE FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- authenticated: agents may only see their own ledger rows.
-- The calling Edge Function must set:  SET LOCAL app.current_agent_id = '<id>';
CREATE POLICY "authenticated_own_ledger_rows"
    ON shared_services.api_ledger
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (
        agent_id = current_setting('app.current_agent_id', true)
    );

-- Indexes
CREATE INDEX idx_ledger_agent_id     ON shared_services.api_ledger (agent_id);
CREATE INDEX idx_ledger_payment_hash ON shared_services.api_ledger (payment_hash);
CREATE INDEX idx_ledger_status       ON shared_services.api_ledger (status);
CREATE INDEX idx_ledger_invoice_ts   ON shared_services.api_ledger (invoice_created_at DESC);


-- -----------------------------------------------------------------------------
-- 5. HELPER: auto-update updated_at via trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared_services.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON shared_services.projects
    FOR EACH ROW EXECUTE FUNCTION shared_services.set_updated_at();

CREATE TRIGGER trg_subnet_registry_updated_at
    BEFORE UPDATE ON shared_services.subnet_registry
    FOR EACH ROW EXECUTE FUNCTION shared_services.set_updated_at();


-- =============================================================================
-- DOWN MIGRATION (rollback — run manually if needed)
-- =============================================================================
-- DROP TRIGGER IF EXISTS trg_subnet_registry_updated_at ON shared_services.subnet_registry;
-- DROP TRIGGER IF EXISTS trg_projects_updated_at ON shared_services.projects;
-- DROP FUNCTION IF EXISTS shared_services.set_updated_at();
-- DROP TABLE IF EXISTS shared_services.api_ledger;
-- DROP TABLE IF EXISTS shared_services.subnet_registry;
-- DROP TABLE IF EXISTS shared_services.projects;
-- DROP SCHEMA IF EXISTS shared_services CASCADE;
