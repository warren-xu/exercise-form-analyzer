"""
MongoDB database connection and configuration
"""
import os
from motor.motor_asyncio import AsyncIOMotorClient
from typing import Optional

class Database:
    client: Optional[AsyncIOMotorClient] = None
    
db = Database()

async def connect_to_mongo():
    """Connect to MongoDB"""
    mongo_url = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    db.client = AsyncIOMotorClient(mongo_url)
    print(f"✓ Connected to MongoDB at {mongo_url}")

async def close_mongo_connection():
    """Close MongoDB connection"""
    if db.client:
        db.client.close()
        print("✓ Closed MongoDB connection")

def get_database():
    """Get the database instance"""
    db_name = os.getenv("MONGODB_DB_NAME", "exercise_form_analyzer")
    return db.client[db_name]

def get_sessions_collection():
    """Get sessions collection"""
    database = get_database()
    return database["sessions"]
