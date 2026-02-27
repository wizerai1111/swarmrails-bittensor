import os
import requests
import json
import time
import sys
from web3 import Web3
from dotenv import load_dotenv

load_dotenv(override=True)

# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------
GATEWAY_URL = "https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate"
BASE_RPC_URL = "https://mainnet.base.org"
USDC_CONTRACT_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
BROKER_WALLET = "0x14a129b3e3Bd154c974118299d75F14626A6157B"
AGENT_PRIVATE_KEY = os.environ.get("AGENT_PRIVATE_KEY", "")

USDC_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "value", "type": "uint256"}
        ],
        "name": "transfer",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]

# ---------------------------------------------------------------------------
# SUBNET BROKER CLASS
# ---------------------------------------------------------------------------
class SubnetBroker:
    def __init__(self, gateway_url, agent_id):
        self.gateway_url = gateway_url
        self.agent_id = agent_id

    def request_and_poll(self, prompt, netuid=1, timeout=300):
        print("🤖 Swarmrails Subnet Broker initialized. Requesting Intelligence...")

        response = self._request_intelligence(prompt=prompt, netuid=netuid)

        if response is None:
            print("ERROR: Got None response from gateway")
            return None

        status = response.get("status")

        if status == "success":
            print("🏆 Intelligence Secured:")
            return response

        if status == "processing":
            job_id = response.get("job_id")
            estimated = response.get("estimated_seconds", 30)
            print("✅ Payment accepted. Job ID: " + str(job_id))
            print("🤖 Step 2: Entering secure polling loop...")
            print("⏳ Sleeping for " + str(estimated) + "s before first poll...")
            time.sleep(estimated)
            return self._poll_job(job_id, timeout=timeout)

        print("⚠️ Unexpected response: " + str(response))
        return response

    def _request_intelligence(self, prompt, netuid):
        payload = {
            "agent_id": self.agent_id,
            "prompt": prompt,
            "netuid": netuid,
        }

        try:
            response = requests.post(self.gateway_url, json=payload)
            print("DEBUG status code: " + str(response.status_code))
        except Exception as e:
            print("ERROR during initial POST: " + str(e))
            return None

        if response.status_code == 402:
            try:
                auth_header = response.headers.get("WWW-Authenticate", "")
                print("DEBUG auth header: " + str(auth_header[:80]))

                parts = auth_header.split("macaroon=")
                if len(parts) < 2:
                    print("ERROR: macaroon not found in header")
                    return None

                macaroon = parts[1].replace('"', '').split(",")[0].strip()
                print("🔒 GATEWAY LOCKED: 402 Payment Required")
                print("✅ Macaroon acquired: " + macaroon[:20] + "...")
            except Exception as e:
                print("ERROR extracting macaroon: " + str(e))
                return None

            tx_hash = self._make_payment()
            if tx_hash is None:
                return None

            print("\n--- Triggering Gateway Unlock ---")
            try:
                paid_response = requests.post(
                    self.gateway_url,
                    json=payload,
                    headers={"Authorization": "x402 " + macaroon + ":" + tx_hash}
                )
                print("DEBUG paid response status: " + str(paid_response.status_code))
                print("DEBUG paid response body: " + paid_response.text[:200])
                return paid_response.json()
            except Exception as e:
                print("ERROR during paid request: " + str(e))
                return None

        try:
            return response.json()
        except Exception as e:
            print("ERROR parsing response JSON: " + str(e))
            print("Raw response: " + response.text[:200])
            return None

    def _poll_job(self, job_id, timeout=300, interval=5):
        start = time.time()
        while time.time() - start < timeout:
            result = self._get_job_result(job_id)
            if result is None:
                print("ERROR: Got None from poll endpoint")
                time.sleep(interval)
                continue

            status = result.get("status")

            if status == "complete":
                print("🏆 Job " + job_id[:8] + "... complete!")
                return result
            elif status == "failed":
                print("❌ Job " + job_id[:8] + "... failed")
                return result
            elif status in ["pending", "processing"]:
                print("🔄 Job " + job_id[:8] + "... status: " + str(status) + ". Retrying in " + str(interval) + "s")
                time.sleep(interval)
            else:
                print("⚠️ Unexpected poll status: " + str(status) + " | Full response: " + str(result))
                time.sleep(interval)

        raise TimeoutError("Job " + job_id + " did not complete within " + str(timeout) + "s")

    def _get_job_result(self, job_id):
        try:
            response = requests.get(
                self.gateway_url,
                params={
                    "job_id": job_id,
                    "agent_id": self.agent_id
                }
            )
            return response.json()
        except Exception as e:
            print("ERROR polling job: " + str(e))
            return None

    def _make_payment(self):
        print("\n💸 Agent initializing autonomous Web3 payment for 5 cents...")
        try:
            w3 = Web3(Web3.HTTPProvider(BASE_RPC_URL))

            if not w3.is_connected():
                print("❌ Failed to connect to Base Network.")
                return None

            agent_account = w3.eth.account.from_key(AGENT_PRIVATE_KEY)
            agent_address = agent_account.address
            usdc_contract = w3.eth.contract(
                address=USDC_CONTRACT_ADDRESS,
                abi=USDC_ABI
            )

            amount_in_base_units = 5 * 10000

            nonce = w3.eth.get_transaction_count(agent_address)
            tx = usdc_contract.functions.transfer(
                w3.to_checksum_address(BROKER_WALLET),
                amount_in_base_units
            ).build_transaction({
                "chainId": 8453,
                "gas": 100000,
                "maxFeePerGas": w3.eth.gas_price,
                "maxPriorityFeePerGas": w3.eth.max_priority_fee,
                "nonce": nonce,
            })

            print("✍️ Agent is cryptographically signing the transaction...")
            signed_tx = w3.eth.account.sign_transaction(tx, private_key=AGENT_PRIVATE_KEY)
            tx_hash_bytes = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            tx_hash_hex = w3.to_hex(tx_hash_bytes)

            print("📡 Broadcasted! Hash: " + tx_hash_hex)
            print("⏳ Waiting for Base blockchain confirmation (usually 2-3 seconds)...")

            receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes)

            if receipt.status == 1:
                print("✅ Payment confirmed on the blockchain!")
                print("⏳ Giving public RPC nodes 4 seconds to index the block...")
                time.sleep(4)
                return tx_hash_hex
            else:
                print("❌ Transaction failed on-chain.")
                return None

        except Exception as e:
            print("ERROR during payment: " + str(e))
            return None


# ---------------------------------------------------------------------------
# STANDALONE TEST
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    broker = SubnetBroker(
        gateway_url=GATEWAY_URL,
        agent_id="sdk_test_agent_002"
    )
    result = broker.request_and_poll(
        prompt="Write a short haiku about an AI discovering a new blockchain.",
        netuid=1
    )
    print(json.dumps(result, indent=2))



