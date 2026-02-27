import os
import json
from dotenv import load_dotenv
from subnet_broker import BrokerClient

load_dotenv(override=True)

# 1. Developer initializes the Swarmrails Subnet Broker SDK
client = BrokerClient(
    gateway_url="https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate",
    agent_id="sdk_test_agent_002",
    private_key=os.environ.get("AGENT_PRIVATE_KEY", "")
)

print("Swarmrails Subnet Broker initialized. Requesting Intelligence...")

# 2. Developer requests data (The SDK handles ALL the Web3 math automatically)
result = client.generate_text("Write a short haiku about an AI discovering a new blockchain.")

print("\nIntelligence Secured:")
print(json.dumps(result, indent=2))
