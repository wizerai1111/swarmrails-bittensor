import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PUBLIC_SUPABASE_URL = 'https://xosljjzcpsouwifbclsy.supabase.co'

const supabaseAdmin = createClient(
  PUBLIC_SUPABASE_URL,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

// ── Provider detection ────────────────────────────────────────────────────────
function detectProvider(url: string): string {
  if (url.includes('openrouter.ai'))  return 'openrouter'
  if (url.includes('together.xyz') || url.includes('together.ai')) return 'together'
  if (url.includes('openai.com'))     return 'openai'
  if (url.includes('queue.fal.run')) return 'fal_queue'
  if (url.includes('fal.run'))        return 'fal_sync'
  if (url.includes('r.jina.ai'))      return 'jina'
  if (url.includes('datura.ai'))      return 'datura'
  return 'unknown'
}

// ── Auth header per provider ──────────────────────────────────────────────────
function providerAuth(provider: string): string {
  switch (provider) {
    case 'openrouter': return `Bearer ${Deno.env.get('OPENROUTER_API_KEY') ?? ''}`
    case 'together':   return `Bearer ${Deno.env.get('TOGETHER_API_KEY') ?? ''}`
    case 'openai':     return `Bearer ${Deno.env.get('OPENAI_API_KEY') ?? ''}`
    case 'fal_queue':
    case 'fal_sync':   return `Key ${Deno.env.get('FAL_KEY') ?? ''}`
    case 'datura':     return Deno.env.get('DATURA_API_KEY') ?? ''
    default:           return ''
  }
}

// ── Merge body_override with prompt, filling any empty-string fields ──────────
// body_override may arrive as a parsed object (jsonb) or raw string (text)
function buildBody(bodyOverrideStr: string | Record<string, any>, prompt: string): Record<string, any> {
  const base: Record<string, any> = typeof bodyOverrideStr === 'string'
    ? JSON.parse(bodyOverrideStr || '{}')
    : (bodyOverrideStr ?? {})
  for (const key of Object.keys(base)) {
    if (base[key] === '') base[key] = prompt
  }
  return base
}

// ── Fal.ai base path for status/result URLs ───────────────────────────────────
// "https://queue.fal.run/fal-ai/hunyuan-video" → "fal-ai/hunyuan-video"
function falBasePath(endpointUrl: string): string {
  return endpointUrl
    .replace('https://queue.fal.run/', '')
    .replace('https://fal.run/', '')
}

// ── bytes → base64 (safe for large buffers) ───────────────────────────────────
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// ── Telegram ops alert (fire-and-forget) ─────────────────────────────────────
function sendTelegramAlert(message: string): void {
  const token  = Deno.env.get('OPS_TELEGRAM_TOKEN')
  const chatId = Deno.env.get('OPS_TELEGRAM_CHAT_ID')
  if (!token || !chatId) return
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message })
  }).catch(() => {})
}

// ─────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  const url = new URL(req.url)

  // ── GET: Poll async job status ──────────────────────────────────────────────
  if (req.method === 'GET') {
    const jobId = url.searchParams.get('job_id')
    if (!jobId) {
      return new Response(JSON.stringify({ error: 'Missing job_id' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const { data, error } = await supabaseAdmin
      .from('gateway_jobs')
      .select('status, video_url, input_prompt, created_at, netuid')
      .eq('fal_request_id', jobId)
      .single()

    if (error || !data) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Fallback: if pending > 30s, try fetching result directly from Fal.ai
    if (data.status === 'pending' && data.netuid) {
      const ageSeconds = (Date.now() - new Date(data.created_at).getTime()) / 1000
      if (ageSeconds > 30) {
        try {
          const { data: subnet } = await supabaseAdmin
            .schema('shared_services')
            .from('subnet_registry')
            .select('endpoint_url')
            .eq('netuid', data.netuid)
            .single()

          if (subnet?.endpoint_url?.includes('fal.run')) {
            const basePath = falBasePath(subnet.endpoint_url)
            const falKey = Deno.env.get('FAL_KEY') ?? ''
            const statusRes = await fetch(
              `https://queue.fal.run/${basePath}/requests/${jobId}/status`,
              { headers: { 'Authorization': `Key ${falKey}` } }
            ).catch(() => null)

            if (statusRes?.ok) {
              const falStatus = await statusRes.json()
              if (falStatus.status === 'COMPLETED' && falStatus.response_url) {
                const resultRes = await fetch(falStatus.response_url, {
                  headers: { 'Authorization': `Key ${falKey}` }
                }).catch(() => null)

                if (resultRes?.ok) {
                  const result = await resultRes.json()
                  const mediaUrl =
                    result.video?.url || result.output?.video?.url ||
                    result.model_mesh?.url || result.output?.model_mesh?.url ||
                    result.images?.[0]?.url || result.image?.url

                  if (mediaUrl) {
                    await supabaseAdmin.from('gateway_jobs')
                      .update({ status: 'completed', video_url: mediaUrl })
                      .eq('fal_request_id', jobId)
                    return new Response(JSON.stringify({
                      status: 'completed', video_url: mediaUrl,
                      input_prompt: data.input_prompt, created_at: data.created_at
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
                  }
                }
              }
            }
          }
        } catch (e: any) {
          console.error('Fal.ai fallback error:', e.message)
        }
      }
    }

    return new Response(JSON.stringify({
      status: data.status, video_url: data.video_url,
      input_prompt: data.input_prompt, created_at: data.created_at
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  // ── POST: Main gateway ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let netuid: number | undefined
    try {
      const { prompt, netuid: _netuid, agent_id, image_url } = JSON.parse(await req.text())
      netuid = _netuid
      console.log(`Request: netuid=${netuid} agent=${agent_id}`)

      if (!prompt || netuid === undefined || netuid === null) {
        return new Response(JSON.stringify({ error: 'Missing prompt or netuid' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        })
      }

      // 2. Look up subnet config from shared_services.subnet_registry
      const { data: subnet, error: configError } = await supabaseAdmin
        .schema('shared_services')
        .from('subnet_registry')
        .select('endpoint_url, body_override, is_async, pricing_sat')
        .eq('netuid', netuid)
        .eq('is_active', true)
        .single()

      if (configError || !subnet?.endpoint_url) {
        return new Response(JSON.stringify({ error: `Subnet ${netuid} not configured or inactive` }), {
          status: 404, headers: { 'Content-Type': 'application/json' }
        })
      }

      if (subnet.pricing_sat === null || subnet.pricing_sat === undefined) {
        return new Response(JSON.stringify({ error: `Subnet ${netuid} uses metered pricing — not supported yet` }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        })
      }

      // 3. x402 Payment Verification
      const authHeader = req.headers.get('Authorization') ?? ''
      if (!authHeader.startsWith('x402 ')) {
        return new Response(JSON.stringify({ error: 'Payment Required' }), {
          status: 402, headers: { 'Content-Type': 'application/json' }
        })
      }

      const credentials = authHeader.slice('x402 '.length)
      const lastColon = credentials.lastIndexOf(':')
      const macaroon = lastColon >= 0 ? credentials.slice(0, lastColon) : credentials
      const txHash = lastColon >= 0 ? credentials.slice(lastColon + 1) : ''

      // Test mode: skip blockchain verification entirely when GATEWAY_TEST_KEY matches
      const gatewayTestKey = Deno.env.get('GATEWAY_TEST_KEY')
      if (macaroon === 'test_mode') {
        if (!gatewayTestKey || txHash !== gatewayTestKey) {
          return new Response(JSON.stringify({ error: 'Invalid or missing test key' }), {
            status: 402, headers: { 'Content-Type': 'application/json' }
          })
        }
        // Test mode validated — skip steps 4-7
      } else {
        if (!txHash || !txHash.startsWith('0x')) {
          return new Response(JSON.stringify({ error: 'Invalid payment format — expected x402 <macaroon>:0x<txhash>' }), {
            status: 402, headers: { 'Content-Type': 'application/json' }
          })
        }

        // 4. Replay protection
        const { data: replayCheck } = await supabaseAdmin
          .from('used_payment_hashes')
          .select('tx_hash')
          .eq('tx_hash', txHash)
          .single()

        if (replayCheck) {
          return new Response(JSON.stringify({ error: 'Payment Already Used' }), {
            status: 402, headers: { 'Content-Type': 'application/json' }
          })
        }

        // 5. Verify Base blockchain transaction (5s timeout)
        const rpcUrl = Deno.env.get('BASE_RPC_URL') ?? 'https://mainnet.base.org'
        let receipt: any = null
        try {
          const rpcRes = await Promise.race([
            fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [txHash], id: 1
              })
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('RPC timeout after 5s')), 5000)
            )
          ])
          receipt = (await rpcRes.json()).result
        } catch (e: any) {
          console.error('RPC error:', e.message)
          return new Response(JSON.stringify({ error: 'Payment verification failed: ' + e.message }), {
            status: 402, headers: { 'Content-Type': 'application/json' }
          })
        }

        if (!receipt) {
          return new Response(JSON.stringify({ error: 'Transaction not found on Base — may be pending or expired' }), {
            status: 402, headers: { 'Content-Type': 'application/json' }
          })
        }

        // 6. Confirm USDC reached the recipient wallet AND amount is sufficient
        const recipientRaw = (Deno.env.get('PAYMENT_RECIPIENT_ADDRESS') ?? '').toLowerCase().replace('0x', '')
        if (!recipientRaw) throw new Error('PAYMENT_RECIPIENT_ADDRESS not configured')

        // USDC Transfer event: topics[0]=Transfer sig, topics[1]=from, topics[2]=to, data=amount
        const USDC_CONTRACT = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
        const TRANSFER_SIG  = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

        const usdcLog = (receipt.logs ?? []).find((log: any) =>
          log.address?.toLowerCase() === USDC_CONTRACT &&
          log.topics?.[0]?.toLowerCase() === TRANSFER_SIG &&
          log.topics?.[2]?.toLowerCase().includes(recipientRaw)
        )
        if (!usdcLog) {
          return new Response(JSON.stringify({ error: 'Payment did not reach the Swarmrails wallet' }), {
            status: 402, headers: { 'Content-Type': 'application/json' }
          })
        }

        // Amount check: pricing_sat → USDC base units (6 decimals)
        // Conversion: 1 sat = $0.001 USDC @ BTC~$100k → required_units = pricing_sat × 1000
        const pricingSat = subnet.pricing_sat ?? 0
        const requiredUnits = BigInt(pricingSat * 1000)
        const transferredUnits = BigInt(usdcLog.data)

        if (transferredUnits < requiredUnits) {
          const sentUsd    = (Number(transferredUnits) / 1e6).toFixed(4)
          const reqUsd     = (Number(requiredUnits)    / 1e6).toFixed(4)
          return new Response(JSON.stringify({
            error: `Insufficient payment: sent $${sentUsd} USDC, required $${reqUsd} USDC for subnet ${netuid}`
          }), { status: 402, headers: { 'Content-Type': 'application/json' } })
        }

        // 7. Record hash (replay protection)
        await supabaseAdmin.from('used_payment_hashes').insert({ tx_hash: txHash })
      }

      // ── 8. Route to provider ──────────────────────────────────────────────
      const endpointUrl = subnet.endpoint_url
      const provider = detectProvider(endpointUrl)
      const auth = providerAuth(provider)
      console.log(`Routing netuid=${netuid} → provider=${provider}`)

      // ── Fal.ai async queue (video, 3D) ─────────────────────────────────────
      if (provider === 'fal_queue') {
        const webhookSecret = Deno.env.get('WEBHOOK_SECRET') ?? ''
        const falWebhookUrl = `${PUBLIC_SUPABASE_URL}/functions/v1/fal_webhook?secret=${webhookSecret}`

        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 10000)
        let falData: any
        try {
          const body = buildBody(subnet.body_override, image_url || prompt)
          const queueUrl = `${endpointUrl}?webhook_url=${encodeURIComponent(falWebhookUrl)}`
          const falRes = await fetch(queueUrl, {
            method: 'POST',
            headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'x-fal-webhook': falWebhookUrl },
            body: JSON.stringify(body),
            signal: ctl.signal
          })
          clearTimeout(timer)
          if (!falRes.ok) throw new Error(`Fal.ai ${falRes.status}: ${await falRes.text()}`)
          falData = await falRes.json()
          console.log('Fal.ai queued:', JSON.stringify(falData))
        } catch (e: any) {
          clearTimeout(timer)
          throw new Error('Fal.ai queue error: ' + e.message)
        }

        const { error: dbErr } = await supabaseAdmin
          .from('gateway_jobs')
          .insert({ fal_request_id: falData.request_id, netuid, input_prompt: prompt, status: 'pending' })
        if (dbErr) throw dbErr

        return new Response(JSON.stringify({
          job_id: falData.request_id, status: 'pending',
          message: 'Job queued. Poll GET ?job_id= for completion.'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      // ── Jina AI web scraping (GET, prompt = URL to scrape) ─────────────────
      if (provider === 'jina') {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 30000)
        try {
          const jinaRes = await fetch(`https://r.jina.ai/${encodeURIComponent(prompt)}`, {
            headers: { 'Accept': 'text/plain' },
            signal: ctl.signal
          })
          clearTimeout(timer)
          if (!jinaRes.ok) throw new Error(`Jina ${jinaRes.status}: ${await jinaRes.text()}`)
          return new Response(JSON.stringify({
            status: 'success',
            data: { content: await jinaRes.text() }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        } catch (e: any) {
          clearTimeout(timer)
          throw new Error('Jina error: ' + e.message)
        }
      }

      // ── OpenAI TTS (returns base64 audio) ─────────────────────────────────
      if (provider === 'openai' && endpointUrl.includes('audio/speech')) {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 30000)
        try {
          const body = buildBody(subnet.body_override, prompt)
          const ttsRes = await fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctl.signal
          })
          clearTimeout(timer)
          if (!ttsRes.ok) throw new Error(`OpenAI TTS ${ttsRes.status}: ${await ttsRes.text()}`)
          const base64Audio = toBase64(await ttsRes.arrayBuffer())
          const override = typeof subnet.body_override === 'string' ? JSON.parse(subnet.body_override || '{}') : (subnet.body_override ?? {})
          return new Response(JSON.stringify({
            status: 'success',
            data: { audio_base64: base64Audio, format: 'mp3', voice: override.voice ?? 'alloy' }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        } catch (e: any) {
          clearTimeout(timer)
          throw new Error('TTS error: ' + e.message)
        }
      }

      // ── Together.xyz image generation ─────────────────────────────────────
      if (provider === 'together') {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 90000)
        try {
          const body = buildBody(subnet.body_override, prompt)
          const togetherRes = await fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctl.signal
          })
          clearTimeout(timer)
          if (!togetherRes.ok) throw new Error(`Together ${togetherRes.status}: ${await togetherRes.text()}`)
          const result = await togetherRes.json()
          return new Response(JSON.stringify({
            status: 'success',
            data: { image_url: result.data?.[0]?.url, model: body.model }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        } catch (e: any) {
          clearTimeout(timer)
          throw new Error('Together error: ' + e.message)
        }
      }

      // ── Datura search ──────────────────────────────────────────────────────
      if (provider === 'datura') {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 30000)
        try {
          const body = buildBody(subnet.body_override, prompt)
          const daturaRes = await fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctl.signal
          })
          clearTimeout(timer)
          if (!daturaRes.ok) throw new Error(`Datura ${daturaRes.status}: ${await daturaRes.text()}`)
          return new Response(JSON.stringify({
            status: 'success', data: await daturaRes.json()
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        } catch (e: any) {
          clearTimeout(timer)
          throw new Error('Datura error: ' + e.message)
        }
      }

      // ── Fal.ai sync (non-queue Trellis etc.) ──────────────────────────────
      if (provider === 'fal_sync') {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 120000)
        try {
          const body = buildBody(subnet.body_override, prompt)
          const falRes = await fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctl.signal
          })
          clearTimeout(timer)
          if (!falRes.ok) throw new Error(`Fal.ai sync ${falRes.status}: ${await falRes.text()}`)
          return new Response(JSON.stringify({
            status: 'success', data: await falRes.json()
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        } catch (e: any) {
          clearTimeout(timer)
          throw new Error('Fal.ai sync error: ' + e.message)
        }
      }

      // ── Default: OpenRouter / any chat completions endpoint ───────────────
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 30000)
      try {
        const body = buildBody(subnet.body_override, prompt)
        body.messages = [{ role: 'user', content: prompt }]
        const res = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Authorization': auth,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://swarmrails.ai',
            'X-Title': 'Swarmrails Gateway'
          },
          body: JSON.stringify(body),
          signal: ctl.signal
        })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`${provider} ${res.status}: ${await res.text()}`)
        return new Response(JSON.stringify({ status: 'success', data: await res.json() }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      } catch (e: any) {
        clearTimeout(timer)
        throw new Error(`${provider} error: ` + e.message)
      }

    } catch (err: any) {
      console.error('Gateway error:', err.message)
      sendTelegramAlert(
        `🚨 Swarmrails Gateway Error\n` +
        `netuid: ${netuid ?? '?'}\n` +
        `error: ${err.message}\n` +
        `time: ${new Date().toISOString()}`
      )
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  return new Response('Method not allowed', { status: 405 })
})
