/**
 * sweep_funds.js — USDC balance sweep using Coinbase CDP SDK v1.44.1
 *
 * Uses @coinbase/cdp-sdk (EVM EOA accounts with named wallets).
 * Usage:  node sweep_funds.js
 * Env:    CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET, RETAIL_ADDRESS
 */

import "dotenv/config";
import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";

const USDC_CONTRACT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const MIN_SWEEP_USD = 1.0;
const WALLET_NAME = "Swarmrailsv2";

async function main() {
  const retailAddress = process.env.RETAIL_ADDRESS;
  if (!retailAddress) throw new Error("RETAIL_ADDRESS not set in .env");

  const apiKeyId = process.env.CDP_API_KEY_ID;
  // dotenv expands \n inside double-quoted values; also handle unquoted \n-escaped storage
  const apiKeySecret = process.env.CDP_API_KEY_SECRET?.replace(/\\n/g, "\n");

  if (!apiKeyId || !apiKeySecret) {
    throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET must be set in .env");
  }

  // Server-managed accounts (listed via cdp.evm.listAccounts) are signed server-side
  // by Coinbase's infrastructure — no walletSecret needed for the transfer call.
  const cdp = new CdpClient({ apiKeyId, apiKeySecret });

  const publicClient = createPublicClient({ chain: base, transport: http() });

  // List all EVM EOA accounts in the project, paginating if needed
  console.log("Scanning EVM EOA accounts in project...\n");
  let targetAccount = null;
  let pageToken;

  do {
    const { accounts, nextPageToken } = await cdp.evm.listAccounts(
      pageToken ? { pageToken } : undefined
    );
    for (const account of accounts) {
      console.log(`  ${(account.name ?? "(unnamed)").padEnd(24)} ${account.address}`);
      if (account.name === WALLET_NAME) targetAccount = account;
    }
    pageToken = nextPageToken;
  } while (pageToken);

  if (!targetAccount) {
    console.log(`\nNo account named "${WALLET_NAME}" found. Exiting.`);
    return;
  }

  console.log(`\nTarget: ${targetAccount.name} (${targetAccount.address})`);

  // Get USDC balance via SDK's listTokenBalances (no viem readContract needed)
  const { balances } = await targetAccount.listTokenBalances({ network: "base" });
  const usdcEntry = balances.find(
    (b) => b.token.contractAddress.toLowerCase() === USDC_CONTRACT
  );

  const rawBalance = usdcEntry?.amount.amount ?? 0n;
  const decimals   = usdcEntry?.amount.decimals ?? 6;
  const usdBalance = parseFloat(formatUnits(rawBalance, decimals));
  console.log(`USDC balance: $${usdBalance.toFixed(6)}`);

  if (usdBalance <= MIN_SWEEP_USD) {
    console.log(`Balance ≤ $${MIN_SWEEP_USD} — nothing to sweep.`);
    return;
  }

  // Sweep the full raw balance to the retail address
  console.log(`\nSweeping $${usdBalance.toFixed(6)} USDC → ${retailAddress} ...`);

  const { transactionHash } = await targetAccount.transfer({
    to: retailAddress,
    amount: rawBalance,  // BigInt, atomic USDC units (6 decimals)
    token: "usdc",
    network: "base",
  });

  console.log(`\nTX hash:  ${transactionHash}`);
  console.log(`Basescan: https://basescan.org/tx/${transactionHash}`);
  console.log("Waiting for on-chain confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });

  if (receipt.status === "success") {
    console.log(`\nConfirmed in block ${receipt.blockNumber}. Sweep complete.`);
  } else {
    console.error("\nTransaction reverted on-chain.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message ?? err);
  if (err.status)  console.error("HTTP status:", err.status);
  if (err.body)    console.error("Response body:", JSON.stringify(err.body, null, 2));
  if (err.cause)   console.error("Cause:", err.cause);
  console.error(err.stack ?? err);
  process.exit(1);
});
