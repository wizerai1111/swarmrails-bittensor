import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Hardcoded to avoid SUPABASE_URL secret resolving to localhost in edge runtime
const PUBLIC_SUPABASE_URL = 'https://xosljjzcpsouwifbclsy.supabase.co'

serve(async (req) => {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')

  // 1. Security Check
  if (secret !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401, 
      headers: { "Content-Type": "application/json" } 
    })
  }

  try {
    const payload = await req.json()
    console.log("Fal Webhook Payload:", JSON.stringify(payload))

    // Extract result URL from async media generation payloads
    // (supports video, 3D mesh, image, and audio response formats)
    const p = payload.payload ?? payload
    const mediaUrl =
      p.video?.url ||
      p.model_mesh?.url ||
      p.images?.[0]?.url ||
      p.image?.url ||
      p.audio?.url ||
      p.output?.video?.url ||
      p.output?.model_mesh?.url
    const requestId = payload.request_id

    if (!requestId) {
      return new Response(JSON.stringify({ error: "Missing request_id" }), { status: 400 })
    }

    const supabaseAdmin = createClient(
      PUBLIC_SUPABASE_URL,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 2. Guarded Update
    const { data, error } = await supabaseAdmin
      .from('gateway_jobs')
      .update({
        video_url: mediaUrl,
        status: mediaUrl ? 'completed' : 'failed'
      })
      .eq('fal_request_id', requestId)
      .select()

    if (error) throw error

    if (!data || data.length === 0) {
      console.warn(`Orphaned Webhook: No record found for ID ${requestId}`)
    } else {
      console.log(`Job ${requestId} updated to ${videoUrl ? 'completed' : 'failed'}`)
    }

    return new Response(JSON.stringify({ success: true }), { 
      status: 200, 
      headers: { "Content-Type": "application/json" } 
    })

  } catch (err) {
    console.error("Webhook Processing Error:", err.message)
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    })
  }
})