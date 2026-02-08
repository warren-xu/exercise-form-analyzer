"""
Snowflake REST API client for querying exercise data.
Uses base64 basic auth instead of native connector to avoid C++ compilation.
"""

import os
import json
import base64
from typing import Dict, List, Any, Optional
import httpx
import logging

logger = logging.getLogger(__name__)

class SnowflakeClient:
    """Snowflake REST API client using basic authentication."""
    
    def __init__(self):
        self.account = os.getenv("SNOWFLAKE_ACCOUNT", "")
        self.user = os.getenv("SNOWFLAKE_USER", "")
        self.password = os.getenv("SNOWFLAKE_PASSWORD", "")
        self.warehouse = os.getenv("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH")
        self.database = os.getenv("SNOWFLAKE_DATABASE", "EXERCISE_ANALYZE")
        self.schema = os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC")
        
        # Build endpoint URL (always use the account/server URL as shown in the Snowflake UI, no region logic)
        self.base_url = f"https://{self.account}.snowflakecomputing.com"
        self.api_url = f"{self.base_url}/api/v2"
        
        # Prepare auth header
        credentials = f"{self.user}:{self.password}"
        encoded = base64.b64encode(credentials.encode()).decode()
        self.auth_header = f"Basic {encoded}"
        
        self.client = httpx.Client(
            headers={
                "Authorization": self.auth_header,
                "Content-Type": "application/json"
            },
            timeout=30.0
        )
    
    def test_connection(self) -> bool:
        """Test Snowflake connection."""
        try:
            response = self.client.post(
                f"{self.api_url}/statements",
                json={
                    "statement": "SELECT CURRENT_TIMESTAMP()",
                    "warehouse": self.warehouse,
                    "database": self.database,
                    "schema": self.schema,
                }
            )
            return response.status_code == 200
        except Exception as e:
            logger.error(f"Snowflake connection test failed: {e}")
            return False
    
    def execute_query(self, query: str) -> List[Dict[str, Any]]:
        """
        Execute a query against Snowflake.
        
        Args:
            query: SQL query string
            
        Returns:
            List of result rows as dictionaries
        """
        try:
            # Submit query
            response = self.client.post(
                f"{self.api_url}/statements",
                json={
                    "statement": query,
                    "warehouse": self.warehouse,
                    "database": self.database,
                    "schema": self.schema,
                }
            )
            
            if response.status_code != 200:
                logger.error(f"Query failed: {response.status_code} - {response.text}")
                return []
            
            data = response.json()
            return data.get("data", [])
            
        except Exception as e:
            logger.error(f"Snowflake query execution failed: {e}")
            return []
    
    def get_sessions(self, user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get user's exercise sessions from Snowflake."""
        query = f"""
        SELECT * FROM SESSIONS 
        WHERE USER_ID = '{user_id}' 
        ORDER BY TIMESTAMP DESC 
        LIMIT {limit}
        """
        return self.execute_query(query)
    
    def get_session_reps(self, session_id: str) -> List[Dict[str, Any]]:
        """Get all reps for a session."""
        query = f"""
        SELECT * FROM REP_CHECKS 
        WHERE SESSION_ID = '{session_id}' 
        ORDER BY REP_INDEX ASC
        """
        return self.execute_query(query)
    
    def get_session_analysis(self, session_id: str) -> Dict[str, Any]:
        """Get aggregated analysis for a session."""
        query = f"""
        SELECT * FROM SESSION_SUMMARY 
        WHERE SESSION_ID = '{session_id}'
        """
        results = self.execute_query(query)
        return results[0] if results else {}
    
    def close(self):
        """Close the HTTP client."""
        self.client.close()


# Global instance
_snowflake_client: Optional[SnowflakeClient] = None

def get_client() -> SnowflakeClient:
    """Get or create Snowflake client instance."""
    global _snowflake_client
    if _snowflake_client is None:
        _snowflake_client = SnowflakeClient()
    return _snowflake_client

def close_client():
    """Close Snowflake client."""
    global _snowflake_client
    if _snowflake_client:
        _snowflake_client.close()
        _snowflake_client = None
