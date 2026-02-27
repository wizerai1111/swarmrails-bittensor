import os
import time
from dotenv import load_dotenv
from supabase import create_client, Client
from web3 import Web3
from web3.exceptions import TransactionNotFound

# 1. Load Environment Variables
load_dotenv(override=True)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# The wallet we generated using the Coinbase SDK
BROKER_WALLET = os.environ.get("BROKER_WALLET_ADDRESS", "0x8B5e0C1cC1449Aa582F8E8960c50A61F4e4c4A1d").lower()

# Base Mainnet Public RPC & USDC Contract Address
BASE_RPC_URL = "https://mainnet.base.org"
USDC_CONTRACT_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".lower()

# The cryptographic signature for an ERC-20 "Transfer" event
TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

# Initialize Clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
w3 = Web3(Web3.HTTPProvider(BASE_RPC_URL))

def verify_payment_hash(tx_hash: str, expected_cents: int) -> bool:
    try:
        # Fetch the transaction receipt from the Base blockchain
        receipt = w3.eth.get_transaction_receipt(tx_hash)
    except TransactionNotFound:
        return False # Transaction is still pending in the mempool
    except Exception as e:
        print(f"Error fetching tx {tx_hash}: {e}")
        return False
        
    # Check if the transaction successfully executed on-chain (1 = success, 0 = failed)
    if receipt['status'] != 1:
        return False
        
    # Calculate required USDC base units (USDC has 6 decimals)
    # Example: 5 cents = 0.05 USDC = 50,000 base units
    required_units = expected_cents * 10000
    
    # Pad the broker wallet address to 32 bytes to match the raw blockchain logs
    padded_broker_address = "0x" + BROKER_WALLET.replace("0x", "").zfill(64).lower()
    
    # Search the logs for the exact USDC transfer to our broker
    for log in receipt['logs']:
        # 1. Was this log emitted by the official USDC contract?
        if log['address'].lower() != USDC_CONTRACT_ADDRESS:
            continue
            
        # 2. Is this a "Transfer" event?
        topics = log['topics']
        if len(topics) < 3:
            continue
        if topics[0].hex() != TRANSFER_EVENT_TOPIC:
            continue
            
        # 3. Did the money actually go to our Broker Wallet? (topic[2] is the 'to' address)
        to_address = "0x" + topics[2].hex()[2:].lower()
        if to_address != padded_broker_address:
            continue
            
        # 4. Is the amount correct? ('data' contains the transferred amount)
        transferred_units = int(log['data'].hex(), 16)
        
        if transferred_units >= required_units:
            return True
            
    return False

def run_verifier_loop():
    if not w3.is_connected():
        print("CRITICAL: Could not connect to Base Network.")
        return
        
    print(f"System: Swarmrails Verification Node Active.")
    print(f"Monitoring Supabase ledger for payments to: {BROKER_WALLET}")
    print("-" * 50)
    
    while True:
        try:
            # Fetch pending invoices where the agent has submitted a transaction hash
            response = supabase.table("api_ledger") \
                .select("id, payment_hash, amount_sat, agent_id") \
                .eq("status", "pending") \
                .not_is_null("payment_hash") \
                .execute()
                
            records = response.data
            
            for record in records:
                tx_hash = record['payment_hash']
                expected_cents = record['amount_sat']
                invoice_id = record['id']
                agent_id = record['agent_id']
                
                print(f"[{time.strftime('%X')}] Validating tx {tx_hash[:10]}... for Agent: {agent_id}")
                
                is_valid = verify_payment_hash(tx_hash, expected_cents)
                
                if is_valid:
                    print(f"✅ Payment Verified! Unlocking Gateway for {agent_id}.")
                    # Update the database so the Deno Edge function lets them through
                    supabase.table("api_ledger") \
                        .update({"status": "paid", "payment_confirmed_at": time.strftime('%Y-%m-%dT%H:%M:%S%z')}) \
                        .eq("id", invoice_id) \
                        .execute()
                else:
                    print(f"⏳ Payment not yet valid or still confirming...")
                    
        except Exception as e:
            print(f"Loop error: {e}")
            
        # Pause for 5 seconds before checking the database again
        time.sleep(5)

if __name__ == "__main__":
    run_verifier_loop()