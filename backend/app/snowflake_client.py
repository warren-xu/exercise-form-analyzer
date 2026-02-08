import snowflake.connector
import os
from dotenv import load_dotenv

load_dotenv()

class SnowflakeClient:
    def __init__(self):
        self.conn = snowflake.connector.connect(
            user=os.getenv("SNOWFLAKE_USER"),
            password=os.getenv("SNOWFLAKE_PASSWORD"),
            account=os.getenv("SNOWFLAKE_ACCOUNT"),
            warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"),
            database=os.getenv("SNOWFLAKE_DATABASE"),
            schema=os.getenv("SNOWFLAKE_SCHEMA"),
        )

    def execute(self, query, params=None):
        cs = self.conn.cursor()
        try:
            cs.execute(query, params or ())
            return cs.fetchall()
        finally:
            cs.close()

    def execute_no_return(self, query, params=None):
        cs = self.conn.cursor()
        try:
            cs.execute(query, params or ())
        finally:
            cs.close()

    def close(self):
        self.conn.close()
