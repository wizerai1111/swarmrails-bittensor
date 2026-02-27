import asyncio
import os
import json
from cdp import CdpClient

# 1. Load your credentials directly into the environment
# Make sure these files are in the 'Cross-Subnet Composability Broker' folder
with open("cdp_api_key.json", "r") as f:
    key_data = json.load(f)
    os.environ["CDP_API_KEY_ID"] = key_data.get("name")
    os.environ["CDP_API_KEY_SECRET"] = key_data.get("privateKey").replace('\\n', '\n')

with open("wallet_secret.txt", "r") as f:
    os.environ["CDP_WALLET_SECRET"] = f.read().strip()

async def main():
    print("Connecting to Coinbase...")
    
    # Initialize the client (picks up environment variables automatically)
    cdp = CdpClient()
    
    try:
        print("Generating EVM Account on Base...")
        # Creates the EVM account
        account = await cdp.evm.create_account()
        
        print("\n" + "="*50)
        print(f"SUCCESS! Your Base Deposit Address is:")
        print(account.address)
        print("="*50)
        print("ACTION: Send your 402 USDC here on the BASE network.")
        
        # 2. Corrected save logic
        # We save the address because EVM Server Accounts use .address, not .id
        with open("broker_identity.txt", "w") as f:
            f.write(account.address)
            
        print("\nIdentity successfully stored in broker_identity.txt.")

    except Exception as e:
        print(f"\nAn error occurred: {e}")
        
    finally:
        # 3. Cleanly close the session
        await cdp.close()

if __name__ == "__main__":
    asyncio.run(main())