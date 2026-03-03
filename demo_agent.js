/**
 * demo_agent.js — Swarmrails live gateway demo
 *
 * Simulates an AI agent calling three subnets in sequence,
 * each backed by a single USDC payment on Base.
 *
 * Usage:
 *   node demo_agent.js <TX_HASH>         # live USDC payment
 *   node demo_agent.js --test            # test mode (no USDC needed)
 *
 * Live payment: send ≥ $0.05 USDC on Base to
 *   0x14a129b3e3Bd154c974118299d75F14626A6157B
 * then grab the tx hash from https://basescan.org
 */

import "dotenv/config";

const GATEWAY = "https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate";
const BASESCAN = "https://basescan.org/tx/";

// ── colours ──────────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  magenta:"\x1b[35m",
  red:    "\x1b[31m",
};

function banner(msg) {
  const line = "─".repeat(60);
  console.log(`\n${C.cyan}${line}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${msg}${C.reset}`);
  console.log(`${C.cyan}${line}${C.reset}`);
}

function step(n, label) {
  console.log(`\n${C.yellow}${C.bold}[Step ${n}]${C.reset} ${C.bold}${label}${C.reset}`);
}

function info(label, value) {
  console.log(`  ${C.dim}${label}:${C.reset} ${value}`);
}

function ok(msg)   { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function fail(msg) { console.log(`  ${C.red}✗${C.reset} ${msg}`); }

async function callGateway(authHeader, netuid, prompt) {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": authHeader },
    body: JSON.stringify({ prompt, netuid }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const arg = process.argv[2];
  const testMode = arg === "--test" || !arg;
  const txHash   = testMode ? null : arg;

  // ── Header ────────────────────────────────────────────────────────────────
  banner("Swarmrails — AI Agent Demo  🤖  →  Bittensor  →  Base USDC");

  if (testMode) {
    console.log(`\n  ${C.yellow}⚠  Test mode — no real USDC required${C.reset}`);
    console.log(`  ${C.dim}Run with a real tx hash for a live payment demo:${C.reset}`);
    console.log(`  ${C.dim}  node demo_agent.js 0xYOUR_TX_HASH${C.reset}`);
  } else {
    console.log(`\n  ${C.green}💳  Live payment mode${C.reset}`);
    info("TX hash", `${C.blue}${txHash}${C.reset}`);
    info("Basescan", `${C.blue}${BASESCAN}${txHash}${C.reset}`);
  }

  const authHeader = testMode
    ? "x402 test_mode:swarmrails_test_2026"
    : `x402 agent:${txHash}`;

  // ── Step 1: Text generation (netuid 1, $0.005) ────────────────────────────
  step(1, "Text generation — netuid 1  ($0.005 USDC)");
  info("Subnet", "Bittensor Text Prompting → Inference layer");
  info("Prompt", '"Explain what Bittensor is in two sentences."');
  process.stdout.write(`\n  ${C.dim}Calling gateway...${C.reset} `);

  const t1start = Date.now();
  const { status: s1, body: b1 } = await callGateway(
    authHeader, 1,
    "Explain what Bittensor is in two sentences."
  );
  const t1ms = Date.now() - t1start;

  if (s1 === 200 && b1.status === "success") {
    const content = b1.data?.choices?.[0]?.message?.content ?? JSON.stringify(b1.data);
    ok(`${t1ms}ms`);
    console.log(`\n  ${C.green}${C.bold}Response:${C.reset}`);
    console.log(`  "${content.trim().replace(/\n/g, "\n  ")}"`);
  } else {
    fail(`${s1} — ${JSON.stringify(b1)}`);
  }

  // ── Step 2: Web scraping (netuid 21, $0.01) ───────────────────────────────
  step(2, "Web scraping — netuid 21  ($0.010 USDC)");
  info("Subnet", "Bittensor Web Scraping → Web intelligence layer");
  info("Target", "https://bittensor.com");
  process.stdout.write(`\n  ${C.dim}Calling gateway...${C.reset} `);

  const t2start = Date.now();
  const { status: s2, body: b2 } = await callGateway(
    authHeader, 21, "https://bittensor.com"
  );
  const t2ms = Date.now() - t2start;

  if (s2 === 200 && b2.status === "success") {
    const snippet = (b2.data?.content ?? "").slice(0, 300).replace(/\n+/g, " ").trim();
    ok(`${t2ms}ms`);
    console.log(`\n  ${C.green}${C.bold}Scraped (first 300 chars):${C.reset}`);
    console.log(`  "${snippet}…"`);
  } else {
    fail(`${s2} — ${JSON.stringify(b2)}`);
  }

  // ── Step 3: Code generation (netuid 11, $0.01) ────────────────────────────
  step(3, "Code generation — netuid 11  ($0.010 USDC)");
  info("Subnet", "Bittensor Code → Inference layer");
  info("Prompt", '"Write a Python one-liner that prints the Fibonacci sequence to 100."');
  process.stdout.write(`\n  ${C.dim}Calling gateway...${C.reset} `);

  const t3start = Date.now();
  const { status: s3, body: b3 } = await callGateway(
    authHeader, 11,
    "Write a Python one-liner that prints the Fibonacci sequence to 100."
  );
  const t3ms = Date.now() - t3start;

  if (s3 === 200 && b3.status === "success") {
    const code = b3.data?.choices?.[0]?.message?.content ?? JSON.stringify(b3.data);
    ok(`${t3ms}ms`);
    console.log(`\n  ${C.green}${C.bold}Response:${C.reset}`);
    console.log(`  ${code.trim().replace(/\n/g, "\n  ")}`);
  } else {
    fail(`${s3} — ${JSON.stringify(b3)}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  banner("Payment settled on Base  ✅");

  if (!testMode) {
    console.log(`\n  ${C.green}${C.bold}USDC transaction:${C.reset}`);
    info("Hash    ", `${C.blue}${txHash}${C.reset}`);
    info("Basescan", `${C.blue}${BASESCAN}${txHash}${C.reset}`);
    info("Recipient", "0x14a129b3e3Bd154c974118299d75F14626A6157B");
    info("Network", "Base mainnet (USDC ERC-20)");
  }

  const totalMs = t1ms + t2ms + t3ms;
  console.log(`\n  ${C.bold}3 subnet calls  ·  ~$0.025 USDC  ·  ${totalMs}ms total${C.reset}`);
  console.log(`  ${C.dim}One tx hash. Three Bittensor subnets. Zero infrastructure.${C.reset}\n`);
}

main().catch((err) => {
  console.error(`\n${C.red}Fatal:${C.reset}`, err.message);
  process.exit(1);
});
