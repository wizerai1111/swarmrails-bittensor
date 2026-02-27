import os
import requests
import json
import sys
import time
from web3 import Web3
from dotenv import load_dotenv

load_dotenv(override=True)

# ---------------------------------------------------------------------------
# 1. AGENT & GATEWAY CONFIGURATION
# ---------------------------------------------------------------------------
GATEWAY_URL = "https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate"
AGENT_ID = "global_test_agent_001"
PROMPT = "Write a short haiku about a robot buying data with crypto."
TOOL_REQUESTED = "text_generation" # Costs 5 cents

# ---------------------------------------------------------------------------
# 2. WEB3 CONFIGURATION (Base Mainnet)
# ---------------------------------------------------------------------------
BASE_RPC_URL = "https://mainnet.base.org"
USDC_CONTRACT_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
BROKER_WALLET = "0x14a129b3e3Bd154c974118299d75F14626A6157B"

AGENT_PRIVATE_KEY = os.environ.get("AGENT_PRIVATE_KEY", "")

# Lightweight ERC-20 ABI (Just enough to send USDC)
USDC_ABI = [{"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}]

def pay_invoice_autonomously(amount_cents):
    print(f"\n💸 Agent initializing autonomous Web3 payment for {amount_cents} cents...")
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_URL))
    
    if not w3.is_connected():
        print("❌ Failed to connect to Base Network.")
        sys.exit(1)

    agent_account = w3.eth.account.from_key(AGENT_PRIVATE_KEY)
    agent_address = agent_account.address
    usdc_contract = w3.eth.contract(address=USDC_CONTRACT_ADDRESS, abi=USDC_ABI)
    
    # USDC has 6 decimals. 1 cent = 0.01 USDC = 10,000 base units.
    amount_in_base_units = amount_cents * 10000 
    
    # Build the Web3 Transaction
    nonce = w3.eth.get_transaction_count(agent_address)
    tx = usdc_contract.functions.transfer(
        w3.to_checksum_address(BROKER_WALLET), 
        amount_in_base_units
    ).build_transaction({
        'chainId': 8453, # Base Mainnet Chain ID
        'gas': 100000,   # Standard gas limit for token transfers
        'maxFeePerGas': w3.eth.gas_price,
        'maxPriorityFeePerGas': w3.eth.max_priority_fee,
        'nonce': nonce,
    })

    # Sign and Broadcast
    print("✍️ Agent is cryptographically signing the transaction...")
    signed_tx = w3.eth.account.sign_transaction(tx, private_key=AGENT_PRIVATE_KEY)
    tx_hash_bytes = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
    tx_hash_hex = w3.to_hex(tx_hash_bytes)
    
    print(f"📡 Broadcasted! Hash: {tx_hash_hex}")
    print("⏳ Waiting for Base blockchain confirmation (usually 2-3 seconds)...")
    
    # Wait for the block to be mined
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes)
    
    if receipt.status == 1:
        print("✅ Payment confirmed on the blockchain!")
        print("⏳ Giving public RPC nodes 4 seconds to index the block...")
        time.sleep(4) # RPC PROPAGATION FIX
        return tx_hash_hex
    else:
        print("❌ Transaction failed on-chain.")
        sys.exit(1)

def run_agent():
    print("🤖 Swarmrails Autonomous Agent Initialized")
    print("--- Initiating API Knock ---")
    
    payload = {
        "agent_id": AGENT_ID,
        "task": TOOL_REQUESTED,
        "prompt": PROMPT
    }
    headers = {"Content-Type": "application/json"}

    # PHASE 1: Request Access (Expect a 402)
    response = requests.post(GATEWAY_URL, json=payload, headers=headers)

    if response.status_code == 402:
        print("🔒 GATEWAY LOCKED: 402 Payment Required")
        
        auth_header = response.headers.get("WWW-Authenticate", "")
        if 'macaroon="' in auth_header:
            macaroon = auth_header.split('macaroon="')[1].split('"')[0]
            print(f"✅ Macaroon acquired: {macaroon[:20]}...")
            
            # 🚀 PHASE 2: AUTONOMOUS PAYMENT EXECUTION
            # The agent pays the 5 cents automatically and gets the hash back
            tx_hash = pay_invoice_autonomously(amount_cents=5)
            
            # PHASE 3: Verify and Retrieve Intelligence
            print(f"\n--- Triggering Gateway Unlock ---")
            
            verify_headers = {
                "Content-Type": "application/json",
                "Authorization": f"x402 {macaroon}:{tx_hash}" # UPDATED TO x402
            }
            
            final_response = requests.post(GATEWAY_URL, json=payload, headers=verify_headers)
            
            if final_response.status_code == 200:
                print("\n🏆 INTELLIGENCE SECURED! GATEWAY UNLOCKED")
                print(json.dumps(final_response.json(), indent=2))
            else:
                print(f"\n❌ VERIFICATION ERROR (HTTP {final_response.status_code}):")
                print(final_response.text)
        else:
            print("❌ Server did not return a valid Macaroon.")
    else:
        print(f"Unexpected response: {response.text}")

if __name__ == "__main__":
    run_agent()