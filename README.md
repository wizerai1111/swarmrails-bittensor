# Swarmrails — Cross-Subnet Composability Broker

**The API Gateway of Gateways for the Agent-to-Agent (A2A) economy.**

One endpoint. One payment. Access to the full Bittensor intelligence network.

---

## Gateway Endpoint

```
https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate
```

---

## Payment Protocol

Swarmrails uses the **x402 protocol** with **USDC on Base blockchain**.

Every POST request requires an `Authorization` header containing a fresh,
unspent USDC transaction hash. Each hash is single-use (10-minute replay window).

**Header format:**
```
Authorization: x402 <any_string>:0xTRANSACTION_HASH
```

**How to pay:**
1. Send USDC on Base to: `0x14a129b3e3Bd154c974118299d75F14626A6157B`
2. Find your transaction hash on [Basescan](https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913)
3. Include it in the Authorization header
4. One hash = one API call

---

## Available Subnets

| netuid | Name | Capability | Price (USDC) | Response |
|--------|------|-----------|-------------|---------|
| 1 | Text Prompting | Conversational AI (Llama 3.3 70B) | $0.005 | Sync |
| 3 | Machine Translation | Multilingual translation | $0.005 | Sync |
| 4 | Targon | Reasoning (DeepSeek-R1) | $0.05 | Sync |
| 5 | Image Generation | Text-to-image (SDXL) | $0.075 | Sync |
| 6 | Nous Research | Fine-tuned LLM inference | $0.01 | Sync |
| 8 | Time Series Prediction | Financial & crypto forecasting | $0.05 | Sync |
| 11 | Code Generation | Advanced code generation | $0.01 | Sync |
| 13 | Data Universe | Data analysis & synthesis | $0.005 | Sync |
| 16 | Voice Cloning / TTS | Text-to-speech (returns mp3 base64) | $0.025 | Sync |
| 18 | Video Generation | Text-to-video MP4 (Hunyuan) | $2.00 | Async |
| 21 | Web Scraping | URL content extraction (Jina) | $0.01 | Sync |
| 24 | Omega Multimodal | Image + text reasoning (Gemini) | $0.02 | Sync |
| 29 | 3D Asset Generation | Image-to-3D mesh GLB (Trellis) | $0.75 | Async |

---

## Request Format

### POST — Submit a job

```json
{
  "prompt": "Your input text",
  "netuid": 1,
  "agent_id": "your_agent_id",
  "image_url": "https://..."
}
```

- `prompt` — required for all subnets
- `netuid` — required; selects the subnet
- `agent_id` — optional; for tracking
- `image_url` — required for netuid 29 (Trellis); pass the source image URL

### GET — Poll async job status

```
GET /payment_gate?job_id=<job_id>
```

---

## Examples

### Text generation (netuid 1, $0.005)

```bash
curl -X POST https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate \
  -H "Content-Type: application/json" \
  -H "Authorization: x402 agent:0xYOUR_TX_HASH" \
  -d '{"prompt": "Explain Bittensor in one paragraph", "netuid": 1}'
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "choices": [{"message": {"content": "Bittensor is..."}}]
  }
}
```

---

### Image generation (netuid 5, $0.075)

```bash
curl -X POST https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate \
  -H "Content-Type: application/json" \
  -H "Authorization: x402 agent:0xYOUR_TX_HASH" \
  -d '{"prompt": "A futuristic city at sunset", "netuid": 5}'
```

**Response:**
```json
{
  "status": "success",
  "data": {"image_url": "https://...", "model": "stabilityai/stable-diffusion-xl-base-1.0"}
}
```

---

### Video generation (netuid 18, $2.00) — async

```bash
# Step 1: Submit
curl -X POST https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate \
  -H "Content-Type: application/json" \
  -H "Authorization: x402 agent:0xYOUR_TX_HASH" \
  -d '{"prompt": "A drone flying over a forest", "netuid": 18}'
# → {"job_id": "abc-123", "status": "pending"}

# Step 2: Poll (every 10s, completes in ~2-5 min)
curl "https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate?job_id=abc-123"
# → {"status": "completed", "video_url": "https://...mp4"}
```

---

### 3D Asset generation (netuid 29, $0.75) — async, requires image input

```bash
# Step 1: Submit with source image
curl -X POST https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate \
  -H "Content-Type: application/json" \
  -H "Authorization: x402 agent:0xYOUR_TX_HASH" \
  -d '{"prompt": "3D asset", "netuid": 29, "image_url": "https://your-image.jpg"}'
# → {"job_id": "xyz-456", "status": "pending"}

# Step 2: Poll (completes in ~30-90s)
curl "https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate?job_id=xyz-456"
# → {"status": "completed", "video_url": "https://...model.glb"}
```

---

### Voice TTS (netuid 16, $0.025)

```bash
curl -X POST https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate \
  -H "Content-Type: application/json" \
  -H "Authorization: x402 agent:0xYOUR_TX_HASH" \
  -d '{"prompt": "Welcome to Swarmrails", "netuid": 16}'
```

**Response:**
```json
{
  "status": "success",
  "data": {"audio_base64": "<mp3 base64>", "format": "mp3", "voice": "alloy"}
}
```

---

## Test Mode (internal use only)

For development and debugging without spending real USDC. Requires the
`GATEWAY_TEST_KEY` secret to be set in the Supabase project.

```
Authorization: x402 test_mode:<GATEWAY_TEST_KEY>
```

> **Warning:** Never share the test key publicly. It bypasses all blockchain
> verification and replay protection. Remove or rotate before going to production.

---

## Error Responses

| Status | Error | Meaning |
|--------|-------|---------|
| 402 | `Payment Required` | Missing x402 Authorization header |
| 402 | `Payment Already Used` | Transaction hash already spent |
| 402 | `Transaction not found on Base` | Hash not yet confirmed on-chain |
| 402 | `Insufficient payment` | USDC amount below subnet price |
| 402 | `Payment did not reach the Swarmrails wallet` | Wrong recipient address |
| 404 | `Subnet N not configured or inactive` | netuid not available |
| 503 | `Subnet N uses metered pricing` | Metered subnet — not yet supported |

---

## USDC Contract (Base)

```
0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
```

## Recipient Wallet (Base)

```
0x14a129b3e3Bd154c974118299d75F14626A6157B
```

![Recipient Wallet QR](https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=0x14a129b3e3Bd154c974118299d75F14626A6157B)

---

## Operator: USDC Sweep Scripts

Automated scripts for sweeping USDC (and ETH) out of the gateway's Coinbase CDP
server accounts. All credentials are loaded from `.env` — never hardcoded.
Copy `.env.example` to `.env` and fill in your values before running.

### Prerequisites

```bash
npm install          # installs @coinbase/cdp-sdk, viem, dotenv
```

Required `.env` keys:

| Key | Description |
|-----|-------------|
| `CDP_API_KEY_ID` | Full API key ID from the CDP portal |
| `CDP_API_KEY_SECRET` | PKCS8 EC private key (PEM, `\n`-escaped single line) |
| `CDP_WALLET_SECRET` | Wallet signing key from the CDP portal (~184-char base64) |
| `RETAIL_ADDRESS` | Destination address for outbound sweeps |

> The CDP API key private key must be in **PKCS8** format (`-----BEGIN PRIVATE KEY-----`).
> If your portal exports it in SEC1 format (`-----BEGIN EC PRIVATE KEY-----`),
> convert it first — see the project history for the `convert_key.js` one-off script.

### Scripts

#### `sweep_funds.js` — sweep Swarmrailsv2 USDC → RETAIL_ADDRESS

Sweeps the full USDC balance from the `Swarmrailsv2` gateway account to your
retail/custodial address. Skips if balance ≤ $1.00. Requires the account to
hold a small ETH balance for gas.

```bash
node sweep_funds.js
```

#### `sweep_burner.js` — sweep SwarmrailBurner USDC → RETAIL_ADDRESS

Same as above but targets the `SwarmrailBurner` account.

```bash
node sweep_burner.js
```

#### `sweep_burner_to_v2.js` — drain SwarmrailBurner → Swarmrailsv2

Internal consolidation script. Sweeps **USDC first** (while ETH is still
available for gas), then sweeps the remaining **ETH** leaving a fixed 0.0001 ETH
gas reserve. Useful after the burner has accumulated funds.

```bash
node sweep_burner_to_v2.js
```

### Notes

- All scripts print the Basescan TX link and wait for on-chain confirmation.
- ETH is required in the source account to pay Base network gas (~0.00001–0.0001 ETH per transfer).
- The CDP API validates balances against a higher internal gas price floor than
  live `estimateFeesPerGas()` returns; `sweep_burner_to_v2.js` uses a fixed
  0.0001 ETH reserve to avoid spurious "Insufficient balance" rejections.
