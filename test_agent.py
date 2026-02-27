import requests
import time

# --- Configuration ---
PROJECT_URL = "https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate"
# Note: If your edge function doesn't require JWT auth, you can remove the Authorization header.
HEADERS = {
    "Content-Type": "application/json",
    "Authorization": "Bearer [YOUR_ANON_KEY]" 
}

def run_agent_workflow():
    print("🤖 Agent: Initiating video generation...")
    
    # 1. POST the request
    payload = {
        "prompt": "A futuristic cyberpunk city with neon lights and flying cars, cinematic 4k",
        "agent_id": "test_agent_001"
    }
    
    post_response = requests.post(PROJECT_URL, json=payload, headers=HEADERS)
    
    if post_response.status_code != 202:
        print(f"❌ Failed to start job: {post_response.text}")
        return

    job_data = post_response.json()
    job_id = job_data.get("job_id")
    print(f"✅ Job accepted by Gateway! Job ID: {job_id}")
    
    # 2. Polling Loop (GET)
    max_attempts = 15
    attempt = 1
    
    while attempt <= max_attempts:
        print(f"⏳ Polling attempt {attempt}/{max_attempts}...")
        
        get_response = requests.get(f"{PROJECT_URL}?job_id={job_id}", headers=HEADERS)
        
        if get_response.status_code != 200:
            print(f"❌ Polling failed: {get_response.text}")
            break
            
        status_data = get_response.json()
        current_status = status_data.get("status")
        
        if current_status == "completed":
            print("\n🎉 SUCCESS! Video is ready.")
            print(f"🖼️ Input Image (Together AI): {status_data.get('input_image_url')}")
            print(f"🎥 Final Video (Fal.ai): {status_data.get('video_url')}")
            break
        elif current_status == "failed":
            print("\n❌ Job failed on the backend.")
            break
        else:
            # Wait 10 seconds before polling again
            time.sleep(10)
            attempt += 1

    if attempt > max_attempts:
        print("⚠️ Polling timed out. The video might still be processing.")

if __name__ == "__main__":
    run_agent_workflow()