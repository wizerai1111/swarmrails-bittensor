import os
import json
import asyncio
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain.agents import initialize_agent, AgentType
from langchain.tools import tool 
from cdp import CdpClient

# Force reload the .env file 
load_dotenv(override=True)

# Load Coinbase Credentials 
try:
    with open("cdp_api_key.json", "r") as f:
        key_data = json.load(f)
        os.environ["CDP_API_KEY_ID"] = key_data.get("name")
        os.environ["CDP_API_KEY_SECRET"] = key_data.get("privateKey").replace('\\n', '\n')

    with open("wallet_secret.txt", "r") as f:
        os.environ["CDP_WALLET_SECRET"] = f.read().strip()
except FileNotFoundError as e:
    print(f"CRITICAL ERROR: Could not find credential files. {e}")
    exit()

# The Blockchain Tool 
async def get_broker_balances_async():
    with open("broker_identity.txt", "r") as f:
        addr = f.read().strip()
    
    async with CdpClient() as cdp:
        result = await cdp.evm.list_token_balances(address=addr, network="base")
        
        balances = []
        for b in result.balances:
            # THE FIX: We reach inside the EvmTokenAmount object to get the actual numbers
            raw_val = float(b.amount.amount)
            decimals = int(b.amount.decimals)
            
            # Calculate the readable amount
            readable_amount = raw_val / (10 ** decimals)
            
            # Format to 6 decimal places so it looks clean (e.g., 0.002364)
            balances.append(f"{b.token.symbol}: {readable_amount:.6f}")
        
        if not balances:
            return f"The wallet {addr} is currently empty."
        return f"The wallet {addr} contains: " + ", ".join(balances)

@tool
def check_wallet_balances(query: str = "") -> str:
    """Use this to check the current ETH and USDC balances of the broker's wallet."""
    return asyncio.run(get_broker_balances_async())

def main():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: OPENAI_API_KEY not found in .env file.")
        return
        
    print(f"System: OpenAI Key detected (Starts with {api_key[:8]}...)")
    print("System: Waking up the Swarmrails Broker Agent...")
    
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    tools = [check_wallet_balances]

    agent = initialize_agent(
        tools=tools,
        llm=llm,
        agent=AgentType.CHAT_ZERO_SHOT_REACT_DESCRIPTION,
        verbose=True 
    )

    prompt = "Identify yourself as the Swarmrails Broker. Check your wallet balance and report your holdings."
    
    print("\n" + "="*50)
    print(f"PROMPT: {prompt}")
    print("="*50 + "\n")

    try:
        response = agent.invoke({"input": prompt})
        print("\n" + "="*50)
        print("FINAL AGENT RESPONSE:")
        print(response["output"])
        print("="*50)
    except Exception as e:
        print(f"\nAI AGENT ERROR: {e}")

if __name__ == "__main__":
    main()