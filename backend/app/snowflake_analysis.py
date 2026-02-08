from app.snowflake_client import SnowflakeClient

# 1. Get average score per session (for bar chart)
def get_avg_score_per_session():
    sf = SnowflakeClient()
    query = """
        SELECT session_id, AVG(score) AS avg_score
        FROM session_reps
        GROUP BY session_id
        ORDER BY avg_score DESC
        LIMIT 10
    """
    result = sf.execute(query)
    sf.close()
    return result

# 2. Get feedback distribution (for pie chart)
def get_feedback_distribution():
    sf = SnowflakeClient()
    query = """
        SELECT feedback, COUNT(*) AS count
        FROM session_reps
        GROUP BY feedback
        ORDER BY count DESC
    """
    result = sf.execute(query)
    sf.close()
    return result

# 3. Get score trend over time for a user (for line chart)
def get_score_trend(user_id):
    sf = SnowflakeClient()
    query = """
        SELECT DATE(timestamp) AS day, AVG(score) AS avg_score
        FROM session_reps
        WHERE user_id = %s
        GROUP BY day
        ORDER BY day
    """
    result = sf.execute(query, (user_id,))
    sf.close()
    return result
