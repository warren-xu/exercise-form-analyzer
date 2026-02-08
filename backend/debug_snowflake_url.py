#!/usr/bin/env python3
"""
Debug script for Snowflake account identifier format.
Tests different URL patterns to find the correct endpoint.
"""

import httpx
import base64
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

account = os.getenv("SNOWFLAKE_ACCOUNT", "DW96877")
user = os.getenv("SNOWFLAKE_USER", "HEATCH")
password = os.getenv("SNOWFLAKE_PASSWORD", "")
warehouse = os.getenv("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH")
database = os.getenv("SNOWFLAKE_DATABASE", "EXERCISE_ANALYZE")
schema = os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC")

print("="*70)
print("SNOWFLAKE ACCOUNT FORMAT DEBUGGER")
print("="*70)
print(f"\nAccount ID: {account}")
print(f"User: {user}")
print(f"Warehouse: {warehouse}")
print(f"Database: {database}")

# Prepare auth
credentials = f"{user}:{password}"
encoded = base64.b64encode(credentials.encode()).decode()
auth_header = f"Basic {encoded}"

# Test different URL patterns
test_urls = [
    # Format 1: account.region.snowflakecomputing.com
    f"https://{account}.us-east-1.snowflakecomputing.com",
    
    # Format 2: account.us-east-1.snowflakecomputing.com (if different region)
    f"https://{account}.us-central-1.snowflakecomputing.com",
    f"https://{account}.us-west-2.snowflakecomputing.com",
    f"https://{account}.eu-west-1.snowflakecomputing.com",
    
    # Format 3: Try without region (newer format)
    f"https://{account}.snowflakecomputing.com",
    
    # Format 4: Try with cloud provider
    f"https://{account}.us-east-1.aws.snowflakecomputing.com",
    f"https://{account}.us-east-1.gcp.snowflakecomputing.com",
    f"https://{account}.us-east-1.azure.snowflakecomputing.com",
]

print("\n" + "="*70)
print("Testing URL patterns...")
print("="*70)

for url in test_urls:
    print(f"\n🔗 Testing: {url}/api/v2/statements")
    try:
        response = httpx.post(
            f"{url}/api/v2/statements",
            json={
                "statement": "SELECT CURRENT_TIMESTAMP()",
                "warehouse": warehouse,
                "database": database,
                "schema": schema,
            },
            headers={
                "Authorization": auth_header,
                "Content-Type": "application/json"
            },
            timeout=5.0
        )
        
        status = response.status_code
        if status == 200:
            print(f"   ✅ SUCCESS! Status: {status}")
            print(f"   Response: {response.json()}")
            print(f"\n🎯 CORRECT ENDPOINT: {url}")
            break
        elif status == 401:
            print(f"   ⚠️  Auth error: Status {status}")
            print(f"      (URL is correct, but credentials may be wrong)")
        elif status == 404:
            print(f"   ❌ Not found: Status {status}")
        else:
            print(f"   ⚠️  Server error: Status {status}")
            if response.text:
                print(f"      {response.text[:100]}")
    except Exception as e:
        print(f"   ❌ Connection error: {str(e)[:80]}")

print("\n" + "="*70)
print("Troubleshooting steps:")
print("="*70)
print("""
1. Check Snowflake account identifier:
   - Go to Snowflake > Account Name > Copy Account Identifier
   - It may look like: "abc12345" or "abc12345.us-east-1" or "abc12345.us-east-1.aws"

2. Verify region:
   - North America: us-east-1, us-west-2, ca-central-1
   - Europe: eu-west-1, eu-central-1
   - Asia Pacific: ap-southeast-1, ap-northeast-1

3. If credentials work in Snowflake console but not here:
   - Verify user has API access enabled
   - Check IP allowlist in Snowflake settings
   - Try using a service account instead

4. Common Snowflake ID formats:
   - SHORT: DW96877
   - FULL (us-east-1): DW96877.us-east-1
   - FULL (AWS): DW96877.us-east-1.aws
""")
