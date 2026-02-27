-- =============================================================================
-- MIGRATION: drop_orphaned_subnet_pricing
-- VERSION:   20260227000000
-- PURPOSE:   Remove public.subnet_pricing — superseded by
--            shared_services.subnet_registry. Gateway now reads exclusively
--            from shared_services.subnet_registry.
-- =============================================================================

DROP TABLE IF EXISTS public.subnet_pricing;
