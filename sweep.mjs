import { CdpClient } from "@coinbase/cdp-sdk";
import { parseUnits, createPublicClient, http } from "viem";
import { base } from "viem/chains";

const cdp = new CdpClient();

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

const sender = await cdp.evm.getAccount({ 
  address: "0x8B5e0C1cC1449Aa582F8E8960c50A61F4e4c4A1d" 
});

const COINBASE_DEPOSIT_ADDRESS = "0x2E80aC063AdB780Aae4BF0c116AbCcb282eFB695";

const { transactionHash } = await sender.transfer({
  to: COINBASE_DEPOSIT_ADDRESS,
  amount: parseUnits("1.00", 6),
  token: "usdc",
  network: "base"
});

const receipt = await publicClient.waitForTransactionReceipt({
  hash: transactionHash,
});

console.log("Transfer status:", receipt.status);
console.log("Basescan:", `https://basescan.org/tx/${transactionHash}`);
