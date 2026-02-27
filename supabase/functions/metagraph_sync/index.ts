import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  console.log("🔄 Initiating Bulletproof Master Subnet Sync...");

  try {
    // A hardcoded Master List to bypass broken third-party APIs
    const masterSubnets = [
      { netuid: 1, name: "Text Prompting", capabilities: ["text_generation"], is_active: true },
      { netuid: 3, name: "Machine Translation", capabilities: ["translation"], is_active: true },
      { netuid: 5, name: "Image Generation", capabilities: ["image_generation"], is_active: true },
      { netuid: 8, name: "Time Series Prediction", capabilities: ["financial_analysis"], is_active: true },
      { netuid: 11, name: "Code Generation", capabilities: ["code_generation"], is_active: true },
      { netuid: 13, name: "Data Universe", capabilities: ["data_scraping"], is_active: true },
      { netuid: 16, name: "Voice Cloning", capabilities: ["audio_generation"], is_active: true },
      { netuid: 18, name: "Video Generation", capabilities: ["video_generation"], is_active: true },
      { netuid: 21, name: "Omega Web Scraping", capabilities: ["web_scraping"], is_active: true },
      { netuid: 24, name: "Omega Multimodal", capabilities: ["multimodal"], is_active: true },
      { netuid: 27, name: "Compute Allocation", capabilities: ["general_compute"], is_active: true },
      { netuid: 29, name: "3D Asset Generation", capabilities: ["3d_generation"], is_active: true }
    ];

    // Upsert the subnets into your database. 
    // Notice we don't define pricing_sat here, so it safely ignores and preserves your custom prices!
    const { error } = await supabase
      .schema("shared_services")
      .from("subnet_registry")
      .upsert(masterSubnets, { 
        onConflict: 'netuid', 
        ignoreDuplicates: false 
      });

    if (error) throw error;

    return new Response(JSON.stringify({ 
      status: "success", 
      message: `Successfully synced ${masterSubnets.length} premium subnets to your registry!` 
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});