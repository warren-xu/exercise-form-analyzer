#!/usr/bin/env python3
"""
Snowflake connection test - validates credentials and connectivity.

This script verifies that Snowflake credentials are correct and that the
REST API endpoint is accessible.

Usage:
    python test_snowflake.py
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment from .env
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

print("\n" + "="*70)
print("SNOWFLAKE CONNECTION TEST")
print("="*70)

# Check if credentials are loaded
account = os.getenv("SNOWFLAKE_ACCOUNT", "")
user = os.getenv("SNOWFLAKE_USER", "")
password = os.getenv("SNOWFLAKE_PASSWORD", "")
warehouse = os.getenv("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH")
database = os.getenv("SNOWFLAKE_DATABASE", "EXERCISE_ANALYZE")
schema = os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC")

print("\n📋 Credentials loaded from .env:")
print(f"   Account:   {account if account else '❌ MISSING'}")
print(f"   User:      {user if user else '❌ MISSING'}")
print(f"   Password:  {'✅ Set' if password else '❌ MISSING'}")
print(f"   Warehouse: {warehouse}")
print(f"   Database:  {database}")
print(f"   Schema:    {schema}")

# Validate credentials
if not all([account, user, password]):
    print("\n❌ ERROR: Missing required Snowflake credentials!")
    print("\nAdd these to backend/.env:")
    print("   SNOWFLAKE_ACCOUNT=your_account_id")
    print("   SNOWFLAKE_USER=your_username")
    print("   SNOWFLAKE_PASSWORD=your_password")
    exit(1)

# Try to import and test httpx
try:
    import httpx
    import base64
except ImportError:
    print("\n❌ ERROR: Required packages not installed!")
    print("   Install with: pip install httpx")
    exit(1)

print("\n" + "="*70)
print("TESTING SNOWFLAKE REST API CONNECTION")
print("="*70)

# Build URL
region = os.getenv("SNOWFLAKE_REGION", "us-east-1").lower()
if "snowflakecomputing.com" in account:
    base_url = f"https://{account}"
elif "." in account:
    base_url = f"https://{account}.snowflakecomputing.com"
else:
    base_url = f"https://{account}.{region}.snowflakecomputing.com"

api_url = f"{base_url}/api/v2"
print(f"\n🔗 Endpoint: {api_url}/statements")

# Prepare authentication
credentials = f"{user}:{password}"
encoded = base64.b64encode(credentials.encode()).decode()
auth_header = f"Basic {encoded}"

# Test 1: Connection
print("\n🧪 Test 1: HTTP Connection")
try:
    response = httpx.post(
        f"{api_url}/statements",
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
        timeout=10.0
    )
    
    if response.status_code == 200:
        print("   ✅ HTTP connection successful")
    else:
        print(f"   ❌ HTTP Error {response.status_code}")
        print(f"      Response: {response.text[:100]}")
        
        if response.status_code == 404:
            print("\n      ⚠️  Account ID format may be incorrect")
            print("      Check SNOWFLAKE_TROUBLESHOOTING.md for help")
        elif response.status_code == 401:
            print("\n      ⚠️  Authentication failed")
            print("      Check username and password")
        exit(1)
        
except Exception as e:
    print(f"   ❌ Connection error: {e}")
    exit(1)

# Test 2: Query Execution
print("\n🧪 Test 2: Query Execution")
try:
    data = response.json()
    if "data" in data:
        print("   ✅ Query executed successfully")
        print(f"      Result: {data['data']}")
    else:
        print("   ⚠️  Query executed but no data returned")
        print(f"      Response: {data}")
except Exception as e:
    print(f"   ❌ Query parsing error: {e}")

# Test 3: Database Verification
print("\n🧪 Test 3: Database Verification")
try:
    response = httpx.post(
        f"{api_url}/statements",
        json={
            "statement": f"SHOW DATABASES LIKE '{database}'",
            "warehouse": warehouse,
        },
        headers={
            "Authorization": auth_header,
            "Content-Type": "application/json"
        },
        timeout=10.0
    )
    
    if response.status_code == 200:
        print(f"   ✅ Database '{database}' exists and is accessible")
    else:
        print(f"   ⚠️  Could not verify database (Status {response.status_code})")
except Exception as e:
    print(f"   ⚠️  Database check failed: {e}")

# Test 4: Schema Verification
print("\n🧪 Test 4: Schema Verification")
try:
    response = httpx.post(
        f"{api_url}/statements",
        json={
            "statement": f"SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '{schema}'",
            "warehouse": warehouse,
            "database": database,
        },
        headers={
            "Authorization": auth_header,
            "Content-Type": "application/json"
        },
        timeout=10.0
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("data"):
            print(f"   ✅ Schema '{schema}' exists and is accessible")
        else:
            print(f"   ⚠️  Schema '{schema}' not found - you may need to create it")
            print(f"      Run in Snowflake: CREATE SCHEMA IF NOT EXISTS {schema};")
    else:
        print(f"   ⚠️  Could not verify schema (Status {response.status_code})")
except Exception as e:
    print(f"   ⚠️  Schema check failed: {e}")

print("\n" + "="*70)
print("✅ SNOWFLAKE CONNECTION TEST COMPLETE")
print("="*70)
print("""
Next steps:
1. Create required tables in Snowflake:
   - SESSIONS table
   - REP_CHECKS table
   
   See: SNOWFLAKE_TROUBLESHOOTING.md for SQL

2. Enable Snowflake in your backend:
   In backend/.env, set: USE_SNOWFLAKE=true

3. Start the backend:
   python -m uvicorn app.main:app --reload --port 3001

4. Test the analysis endpoint:
   GET /api/analysis/{session_id}
   Response should include: "data_source": "snowflake"
""")
