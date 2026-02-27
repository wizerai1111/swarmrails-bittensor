# THE AGENT Swarmrails - PROJECT MEMORY

## 1. The Mission
We are building "Swarmrails," the premier API Gateway of Gateways for the 2026 Agent-to-Agent (A2A) economy.
- **Goal:** Broker external agent access to complex, multi-subnet Bittensor intelligence via a single entry point.
- **Constraint:** Fully serverless on a single Supabase project (<$10/mo).
- **Revenue:** Monetized via the x402 protocol using Base blockchain USDC micropayments.

## 2. Current Production Status
- ✅ Text subnets (netuid 1, 3, 4, 6, 8, 11, 13) — fully working via OpenRouter
- ✅ x402 payment verification on Base blockchain
- ✅ Dynamic pricing from `subnet_pricing` table
- ✅ Replay protection (10-minute transaction hash TTL)
- ✅ Telegram ops alerts
- ⏳ Video subnet (netuid 18) via Fal.ai — pipeline built, webhook delivery pending fix

## 3. Payment Protocol (IMPORTANT CORRECTION)
- **Current implementation uses x402 on Base blockchain (USDC), NOT Lightning Network**
- Auth header format: `Authorization: x402 dummy_macaroon:0xTRANSACTION_HASH`
- Fresh transaction hashes from: `https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
- Hashes expire after 10 minutes (replay protection enforced in `payment_gate`)
- `CLAUDE.md` previously said "Lightning Network / Satoshis" — this is outdated, ignore it

## 4. Critical Infrastructure Notes
- `Deno.env.get('SUPABASE_URL')` resolves to `http://localhost:9999` inside Edge Function runtime — NEVER use it to build public-facing URLs
- Always use hardcoded: `const PUBLIC_SUPABASE_URL = 'https://xosljjzcpsouwifbclsy.supabase.co'`
- All functions must be deployed with `--no-verify-jwt` flag
- Deploy order: `fal_webhook` first, then `payment_gate`

## 5. The Tech Stack
- **Backend:** Supabase (Postgres)
- **Compute:** Supabase Edge Functions (Deno / TypeScript)
- **Text AI:** OpenRouter (routes to Llama, etc. via Novita)
- **Video AI:** Fal.ai async queue (`fal-ai/luma-dream-machine` for netuid 18)
- **Payments:** x402 protocol on Base blockchain (USDC)
- **Alerts:** Telegram bot

## 6. Database Tables
- `subnet_pricing` — netuid → provider, fal_model_path, price_cents
- `gateway_jobs` — async video job tracking (fal_request_id, status, video_url, input_prompt, netuid, created_at, updated_at)

## 7. Edge Functions
- `payment_gate` — main gateway: x402 verification → routing → video job init + GET polling endpoint
- `fal_webhook` — receives Fal.ai delivery callback, updates gateway_jobs, validates WEBHOOK_SECRET

## 8. Active Secrets (all confirmed set)
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
FAL_KEY, FAL_API_KEY, WEBHOOK_SECRET, BASE_RPC_URL,
BROKER_WALLET_ADDRESS, PAYMENT_RECIPIENT_ADDRESS,
OPENROUTER_API_KEY, TOGETHER_API_KEY,
SUBNET_1_API_KEY through SUBNET_29_API_KEY,
OPS_TELEGRAM_TOKEN, OPS_TELEGRAM_CHAT_ID

## 9. Known Issues To Fix
1. `payment_gate` Base RPC verification call has no timeout guard — add 5 second timeout or it hangs indefinitely
2. Video webhook URL must use `PUBLIC_SUPABASE_URL` not `SUPABASE_URL` env var
3. Fal.ai model for netuid 18 must be `fal-ai/luma-dream-machine` (text-to-video), not `fal-ai/fast-svd` (image-to-video)

## 10. The "Staff" Personas
- **@Architect:** Deno Edge Functions, x402 Middleware, Dynamic Routing
- **@DB_Admin:** SQL schemas, RLS policies, pg_cron
- **@Security:** x402 verification, API key audits, Zod validation
- **@Product:** A2A value proposition, pricing models, subnet task-mapping
- **@TAO_Specialist:** Bittensor Metagraph sync, subnet parsing
