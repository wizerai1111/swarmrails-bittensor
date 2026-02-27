const SUPABASE_URL = "https://xosljjzcpsouwifbclsy.supabase.co";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/payment_gate`;

// Remove the zero at the start!
const TX_HASH = "test_hash_v1_001";

const PAYLOAD = {
  agent_id: "test-agent-001",
  netuid: 18, 
  prompt: "A cinematic shot of a glowing cyberpunk city at night, highly detailed, 4k"
};

async function runTest() {
  console.log(`🚀 Target: ${FUNCTION_URL}`);
  console.log(`🔑 TX Hash: ${TX_HASH}\n`);

  try {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `x402 macaroon:${TX_HASH}`
      },
      body: JSON.stringify(PAYLOAD)
    });

    const data = await response.json();

    if (!response.ok) {
      console.log("❌ SERVER REJECTED REQUEST:");
      console.log(data);
      return;
    }

    // 🚨 DEBUG: Print exactly what the server sent back!
    console.log("📥 RAW SERVER RESPONSE:", data);

    if (!data.job_id) {
        console.log("\n🛑 SCRIPT STOPPED: The server didn't give us a job_id! Check the raw response above to see what it actually returned.");
        return;
    }

    console.log(`\n✅ JOB QUEUED: ${data.job_id}`);
    console.log("⏳ Polling for results every 10s...\n");

    const jobId = data.job_id;
    while (true) {
      await new Promise(r => setTimeout(r, 10000)); 

      const pollResponse = await fetch(`${FUNCTION_URL}?job_id=${jobId}`);
      const pollData = await pollResponse.json();
      const time = new Date().toLocaleTimeString();

      if (pollData.status === "processing") {
        console.log(`[${time}] ⏳ Still processing...`);
      } else if (pollData.status === "complete") {
        console.log(`\n🎉 SUCCESS! Video Ready:`);
        console.log(pollData.result.url || pollData.result);
        break;
      } else if (pollData.status === "failed") {
        console.log(`\n❌ JOB FAILED:`);
        console.log(pollData.result);
        break;
      } else {
        // Catch-all so it never fails silently again!
        console.log(`[${time}] ⚠️ UNKNOWN SERVER RESPONSE:`, pollData);
        break;
      }
    }
  } catch (err) {
    console.error("Critical Script Error:", err.message);
  }
}

runTest();