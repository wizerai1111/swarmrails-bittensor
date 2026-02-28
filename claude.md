# THE AGENT Swarmrails - PROJECT MEMORY

## 1. The Mission
We are building "Swarmrails," the premier API Gateway of Gateways for the 2026 
Agent-to-Agent (A2A) economy.
- **Goal:** Broker external agent access to complex, multi-subnet Bittensor 
  intelligence via a single entry point.
- **Constraint:** Fully serverless on a single Supabase project (<$10/mo).
- **Revenue:** Monetized via the x402 protocol using Base blockchain USDC micropayments.
- **Supabase Project ID:** xosljjzcpsouwifbclsy
- **Supabase URL:** https://xosljjzcpsouwifbclsy.supabase.co


## 2. Current Production Status
- ✅ Text subnets (netuid 1, 3, 4, 6, 8, 11, 13) — fully working via OpenRouter
- ✅ Image generation (netuid 18) — async queue + webhook pattern complete
- ✅ Video subnet (netuid 19) — Kling v1.6 via Fal.ai, async pipeline working
- ✅ Code generation (netuid 4)
- ✅ Translation (netuid 5)
- ✅ Time series forecasting (netuid 8)
- ✅ Web scraping via Jina (netuid 21)
- ✅ Multimodal reasoning (netuid 24)
- ✅ Data analysis (netuid 27)
- ✅ x402 payment verification on Base blockchain
- ✅ Dynamic routing from `shared_services.subnet_registry` (subnet_pricing was dropped 2026-02-27)
- ✅ Replay protection (10-minute TTL) via `public.used_payment_hashes` table
- ✅ Telegram ops alerts
- ✅ metagraph_sync deployed with --no-verify-jwt
- ✅ .env confirmed in .gitignore
- ✅ 3D Assets (netuid 29) — Trellis via Fal.ai async queue; requires `image_url` input (image-to-3D)
- ✅ Voice Cloning / TTS (netuid 16) — OpenAI TTS, returns `audio_base64` (mp3)
- ⏳ CCA (Cross-Chain Auction) UX/frontend — Next.js + Wagmi


## 3. Payment Protocol (IMPORTANT)
- **Uses x402 on Base blockchain (USDC) — NOT Lightning Network**
- Auth header format: `Authorization: x402 dummy_macaroon:0xTRANSACTION_HASH`
- Fresh transaction hashes from:
  `https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
- **Replay protection:** Hashes stored in `public.used_payment_hashes` (tx_hash PK, used_at) with 10-min TTL
- Replay check runs BEFORE routing — duplicate hash = immediate 402 rejection
- Any reference to "Lightning Network / Satoshis" is outdated — ignore it


## 4. Critical Infrastructure Notes
- `Deno.env.get('SUPABASE_URL')` resolves to `http://localhost:9999` inside Edge 
  Function runtime — NEVER use it to build public-facing URLs
- Always hardcode: `const PUBLIC_SUPABASE_URL = 'https://xosljjzcpsouwifbclsy.supabase.co'`
- All functions must be deployed with `--no-verify-jwt` flag
- Deploy order: `fal_webhook` first, then `payment_gate`
- Base RPC timeout guard needed — add 5s timeout to verification call (known issue)


## 5. Tech Stack
- **Backend:** Supabase (Postgres)
- **Compute:** Supabase Edge Functions (Deno / TypeScript)
- **Text AI:** OpenRouter (routes to Llama, etc. via Novita)
- **Image/Video AI:** Fal.ai async queue
- **Payments:** x402 protocol on Base blockchain (USDC)
- **Alerts:** Telegram bot
- **Claude Code API:** OpenRouter (direct Anthropic API has org provisioning 
  bug — reported to support)


## 6. Database Tables (live as of 2026-02-28)

**public schema** (gateway-facing):
| Table | Key Columns | Purpose |
|---|---|---|
| `gateway_jobs` | fal_request_id, netuid, input_prompt, status, video_url, created_at, updated_at | Async Fal.ai job tracking |
| `used_payment_hashes` | tx_hash (PK), used_at | x402 replay protection — 10-min TTL |

**shared_services schema** (cross-agent backbone):
| Table | Key Columns | Purpose |
|---|---|---|
| `projects` | agent_id (UNIQUE), schema_name (UNIQUE), display_name, is_active | Master agent registry |
| `subnet_registry` | netuid (UNIQUE), name, capabilities (JSONB), endpoint_url, is_active, last_synced_at | Bittensor subnet catalog — source of truth for routing |
| `api_ledger` | payment_hash (UNIQUE), agent_id, amount_sat, status, tool_name, request_payload, response_payload | L402 ledger (legacy Lightning) |
| `agent_jobs` | id, agent_id, netuid, status, tx_hash, result (JSONB), completed_at | A2A SDK job tracking |
| `transaction_ledger` | tx_hash (PK), agent_id, amount_cents, verified | x402 USDC payment records |
| `sync_config` | (sync schedule/config for metagraph_sync) | pg_cron metagraph sync config |

**Per-agent schemas** (created by `provision_new_agent()` RPC):
Each agent gets `agent_<name>.agent_logs` and `agent_<name>.memory` (pgvector, 1536-dim).
Live: `agent_alpha`, `agent_global_test`.

> NOTE: `public.subnet_pricing` was dropped (migration 20260227). Do NOT reference it.
> Dashboard: https://supabase.com/dashboard/project/xosljjzcpsouwifbclsy


## 7. Edge Functions
| Function | Version | Role | verify_jwt |
|---|---|---|---|
| `payment_gate` | v94 | Main gateway: x402 verify → route → async job init + GET polling | false |
| `fal_webhook` | v22 | Receives Fal.ai callback, updates gateway_jobs, validates WEBHOOK_SECRET | false |
| `metagraph_sync` | v55 | Bittensor metagraph sync | false |

```bash
supabase functions deploy <function_name> --no-verify-jwt
```

## 8. Async Queue Pattern (netuids 18, 29)
1. POST: `payment_gate` submits to `queue.fal.run` with webhook URL → inserts row in `gateway_jobs` → returns `{ job_id, status: "pending" }`
2. `fal_webhook` receives Fal.ai callback → extracts media URL (video, model_mesh, images, audio) → updates `gateway_jobs.status = "completed"`
3. GET `?job_id=`: polls `gateway_jobs`; if pending > 30s, falls back to direct Fal.ai status check (authenticated with FAL_KEY)

**netuid 29 (Trellis) call format** — requires `image_url` (image-to-3D, not text-to-3D):
```json
{ "prompt": "any", "netuid": 29, "image_url": "https://..." }
```
Response: `{ "job_id": "...", "status": "pending" }` → poll GET → `{ "status": "completed", "video_url": "https://...model.glb" }`

**Test mode** (no real USDC needed):
```
Authorization: x402 test_mode:swarmrails_test_2026
```

## 9. Known Issues / Migration Notes
- `supabase db pull` / `db push` requires `--include-all` flag due to `20260221_agent_factory.sql` being out-of-order (predates last remote migration). Use dashboard SQL Editor to clean `supabase_migrations.schema_migrations` if it re-occurs.
- `shared_services.api_ledger` uses `amount_sat` (Lightning legacy) — not used by active x402 flow
- Subnets 27, 64 have `pricing_sat = null` (metered) — payment_gate returns 503 for these until metered billing is built
- Subnets 22, 64, 80 are `is_active = false` — safe to ignore
- pg_cron job `swarmrails_payment_hash_ttl` runs every 5 min, deletes `used_payment_hashes` rows older than 10 min. Cannot verify via PostgREST (cron schema not exposed) — check via dashboard SQL: `SELECT jobname, schedule, active FROM cron.job;`

