from subnet_broker import SubnetBroker, GATEWAY_URL
import json

broker = SubnetBroker(
    gateway_url=GATEWAY_URL,
    agent_id="sdk_test_agent_002"
)

result = broker.request_and_poll(
    prompt="Write a short haiku about an AI discovering a new blockchain.",
    netuid=1  # make sure is_async=true in DB for async test
)

print(json.dumps(result, indent=2))

