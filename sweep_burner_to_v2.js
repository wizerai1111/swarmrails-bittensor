/**
 * sweep_burner_to_v2.js — Drain SwarmrailBurner → Swarmrailsv2
 *
 * Order: USDC first (gas still available), then remaining ETH minus gas cost.
 * Usage: node sweep_burner_to_v2.js
 * Env:   CDP_API_KEY_ID, CDP_API_KEY_SECRET (from .env)
 */

import "dotenv/config";
import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatUnits, formatEther } from "viem";
import { base } from "viem/chains";

const USDC_CONTRACT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOURCE_WALLET = "SwarmrailBurner";
const DEST_ADDRESS  = "0x14a129b3e3Bd154c974118299d75F14626A6157B"; // Swarmrailsv2

// Fixed ETH gas reserve: 0.0001 ETH covers a plain transfer at up to ~5 gwei on Base.
// Dynamic estimateFeesPerGas() returns instantaneous prices that can be far below
// the CDP API's internal validation floor, causing spurious "Insufficient balance" errors.
const GAS_RESERVE = 100_000_000_000_000n; // 0.0001 ETH in wei

async function main() {
  const apiKeyId     = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET?.replace(/\\n/g, "\n");

  if (!apiKeyId || !apiKeySecret) {
    throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET must be set in .env");
  }

  const cdp          = new CdpClient({ apiKeyId, apiKeySecret });
  const publicClient = createPublicClient({ chain: base, transport: http() });

  // ── Locate SwarmrailBurner ───────────────────────────────────────────────
  console.log("Scanning EVM EOA accounts...\n");
  let burner    = null;
  let pageToken;

  do {
    const { accounts, nextPageToken } = await cdp.evm.listAccounts(
      pageToken ? { pageToken } : undefined
    );
    for (const account of accounts) {
      console.log(`  ${(account.name ?? "(unnamed)").padEnd(24)} ${account.address}`);
      if (account.name === SOURCE_WALLET) burner = account;
    }
    pageToken = nextPageToken;
  } while (pageToken);

  if (!burner) {
    console.log(`\nNo account named "${SOURCE_WALLET}" found. Exiting.`);
    return;
  }

  console.log(`\nSource : ${burner.name} (${burner.address})`);
  console.log(`Dest   : ${DEST_ADDRESS}\n`);

  // ── Step 1: Sweep USDC (do this while ETH is still available for gas) ───
  const { balances } = await burner.listTokenBalances({ network: "base" });
  const usdcEntry = balances.find(
    (b) => b.token.contractAddress.toLowerCase() === USDC_CONTRACT
  );
  const rawUsdc = usdcEntry?.amount.amount ?? 0n;

  console.log(`USDC balance: $${formatUnits(rawUsdc, usdcEntry?.amount.decimals ?? 6)}`);

  if (rawUsdc > 0n) {
    console.log(`Sweeping ${formatUnits(rawUsdc, 6)} USDC → ${DEST_ADDRESS} ...`);

    const { transactionHash: usdcTx } = await burner.transfer({
      to: DEST_ADDRESS,
      amount: rawUsdc,
      token: "usdc",
      network: "base",
    });

    console.log(`TX hash:  ${usdcTx}`);
    console.log(`Basescan: https://basescan.org/tx/${usdcTx}`);
    console.log("Waiting for USDC confirmation...");

    const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcTx });
    if (usdcReceipt.status !== "success") throw new Error("USDC transfer reverted");
    console.log(`Confirmed in block ${usdcReceipt.blockNumber}.\n`);
  } else {
    console.log("No USDC to sweep.\n");
  }

  // ── Step 2: Sweep ETH (leave enough for gas on this very transfer) ───────
  const ethBalance = await publicClient.getBalance({ address: burner.address });
  console.log(`ETH balance: ${formatEther(ethBalance)} ETH`);

  if (ethBalance === 0n) {
    console.log("ETH balance is 0 — nothing to sweep.");
    return;
  }

  const ethToSend = ethBalance - GAS_RESERVE;

  console.log(`Gas reserve:  ${formatEther(GAS_RESERVE)} ETH (fixed, covers up to ~5 gwei on Base)`);

  if (ethToSend <= 0n) {
    console.log(`ETH balance too low to cover gas — skipping ETH sweep.`);
    return;
  }

  console.log(`Sweeping ${formatEther(ethToSend)} ETH → ${DEST_ADDRESS} ...`);

  const { transactionHash: ethTx } = await burner.transfer({
    to: DEST_ADDRESS,
    amount: ethToSend,
    token: "eth",
    network: "base",
  });

  console.log(`TX hash:  ${ethTx}`);
  console.log(`Basescan: https://basescan.org/tx/${ethTx}`);
  console.log("Waiting for ETH confirmation...");

  const ethReceipt = await publicClient.waitForTransactionReceipt({ hash: ethTx });
  if (ethReceipt.status === "success") {
    console.log(`Confirmed in block ${ethReceipt.blockNumber}. All sweeps complete.`);
  } else {
    throw new Error("ETH transfer reverted");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message ?? err);
  if (err.status) console.error("HTTP status:", err.status);
  if (err.body)   console.error("Response body:", JSON.stringify(err.body, null, 2));
  if (err.cause)  console.error("Cause:", err.cause);
  console.error(err.stack ?? err);
  process.exit(1);
});
