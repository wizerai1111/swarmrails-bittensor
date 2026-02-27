import asyncio
import os
import json
from cdp import CdpClient

# 1. Load your credentials
with open("cdp_api_key.json", "r") as f:
    key_data = json.load(f)
    os.environ["CDP_API_KEY_ID"] = key_data.get("name")
    os.environ["CDP_API_KEY_SECRET"] = key_data.get("privateKey").replace('\\n', '\n')

with open("wallet_secret.txt", "r") as f:
    os.environ["CDP_WALLET_SECRET"] = f.read().strip()

async def main():
    # 2. Read the address we just saved
    with open("broker_identity.txt", "r") as f:
        broker_address = f.read().strip()

    print(f"Checking balances for Broker Agent: {broker_address}...")
    
    # 3. Connect to CDP
    async with CdpClient() as cdp:
        try:
            # EXACT FIX: Changed "base-mainnet" to "base"
            result = await cdp.evm.list_token_balances(
                address=broker_address,
                network="base" 
            )
            
            print("\n" + "="*40)
            print("CURRENT WALLET BALANCES")
            print("="*40)
            
            if not result.balances:
                print("Status: ⏳ Wallet is currently empty. Waiting for Kraken withdrawal to clear...")
            else:
                for b in result.balances:
                    # Print the token symbol (like ETH or USDC) and the amount
                    print(f"Token: {b.token.symbol} | Amount: {b.amount}")
                    
            print("="*40)
                    
        except Exception as e:
            print(f"Error checking balance: {e}")

if __name__ == "__main__":
    asyncio.run(main())