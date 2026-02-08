"""
Form analysis module: queries MongoDB or Snowflake data and performs analysis.
Supports both MongoDB (local development) and Snowflake (production analytics).

Analyzes:
- Trends: Is form improving or degrading over time?
- Weak areas: Which form checks fail most frequently?
- Consistency: How variable are the reps?
- Rep breakdown: Detailed insights per rep
"""
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from statistics import stdev, mean
import os
from .database import get_sessions_collection

class FormAnalyzer:
    """Analyzes squat form data from MongoDB or Snowflake."""
    
    def __init__(self):
        self.severity_weights = {
            'low': 0,
            'moderate': 1,
            'high': 2,
        }
        # Check if Snowflake should be used (default: MongoDB for compatibility)
        self.use_snowflake = os.getenv("USE_SNOWFLAKE", "").lower() == "true"
        
        if self.use_snowflake:
            from .snowflake import get_client
            self.snowflake = get_client()
        else:
            self.snowflake = None
    
    async def analyze_session(self, session_id: str, user_id: str) -> Dict[str, Any]:
        """Analyze a specific session and compare against user history."""
        try:
            if self.use_snowflake and self.snowflake:
                return self._analyze_session_snowflake(session_id, user_id)
            else:
                return await self._analyze_session_mongodb(session_id, user_id)
        except Exception as e:
            return {"error": f"Analysis failed: {str(e)}"}
    
    async def _analyze_session_mongodb(self, session_id: str, user_id: str) -> Dict[str, Any]:
        """Analyze session using MongoDB."""
    async def _analyze_session_mongodb(self, session_id: str, user_id: str) -> Dict[str, Any]:
        """Analyze session using MongoDB."""
        sessions = get_sessions_collection()
        
        # Get current session
        current_session = await sessions.find_one({
            "session_id": session_id,
            "user_id": user_id
        })
        
        if not current_session:
            return {"error": "Session not found"}
        
        # Get user's historical sessions (last 10)
        history = []
        async for doc in sessions.find(
            {"user_id": user_id}
        ).sort("timestamp", -1).limit(10):
            history.append(doc)
        
        # Analyze current session
        current_analysis = self._analyze_single_session(current_session)
        
        # Calculate trends and comparisons
        trends = self._calculate_trends(history)
        weak_areas = self._identify_weak_areas(current_session)
        consistency = self._calculate_consistency(current_session)
        
        return {
            "session_id": session_id,
            "timestamp": current_session.get("timestamp", datetime.now(timezone.utc)).isoformat(),
            "rep_count": current_session.get("rep_count", 0),
            "current_session": current_analysis,
            "trends": trends,
            "weak_areas": weak_areas,
            "consistency": consistency,
            "comparison": self._compare_to_history(current_session, history),
            "recommendations": self._generate_recommendations(weak_areas, trends),
        }
    
    def _analyze_session_snowflake(self, session_id: str, user_id: str) -> Dict[str, Any]:
        """Analyze session using Snowflake REST API."""
        try:
            # Get current session from Snowflake
            current_session_results = self.snowflake.execute_query(f"""
                SELECT * FROM SESSIONS 
                WHERE SESSION_ID = '{session_id}' AND USER_ID = '{user_id}'
            """)
            
            if not current_session_results:
                return {"error": "Session not found"}
            
            current_session = current_session_results[0]
            
            # Get user's historical sessions
            history_results = self.snowflake.execute_query(f"""
                SELECT * FROM SESSIONS 
                WHERE USER_ID = '{user_id}' 
                ORDER BY TIMESTAMP DESC 
                LIMIT 10
            """)
            
            history = history_results if history_results else []
            
            # Get reps for current session
            reps_results = self.snowflake.execute_query(f"""
                SELECT * FROM REP_CHECKS 
                WHERE SESSION_ID = '{session_id}' 
                ORDER BY REP_INDEX ASC
            """)
            
            current_session["reps"] = reps_results if reps_results else []
            current_session["rep_count"] = len(current_session["reps"])
            
            # Add reps to history sessions
            for hist_session in history:
                hist_reps = self.snowflake.execute_query(f"""
                    SELECT * FROM REP_CHECKS 
                    WHERE SESSION_ID = '{hist_session.get("SESSION_ID")}' 
                    ORDER BY REP_INDEX ASC
                """)
                hist_session["reps"] = hist_reps if hist_reps else []
                hist_session["rep_count"] = len(hist_session["reps"])
            
            # Perform analysis
            current_analysis = self._analyze_single_session(current_session)
            trends = self._calculate_trends(history)
            weak_areas = self._identify_weak_areas(current_session)
            consistency = self._calculate_consistency(current_session)
            
            return {
                "session_id": session_id,
                "timestamp": current_session.get("TIMESTAMP", datetime.now(timezone.utc)).isoformat() if self._is_datetime_like(current_session.get("TIMESTAMP")) else datetime.now(timezone.utc).isoformat(),
                "rep_count": current_session.get("rep_count", 0),
                "current_session": current_analysis,
                "trends": trends,
                "weak_areas": weak_areas,
                "consistency": consistency,
                "comparison": self._compare_to_history(current_session, history),
                "recommendations": self._generate_recommendations(weak_areas, trends),
                "data_source": "snowflake"
            }
        except Exception as e:
            return {"error": f"Snowflake analysis failed: {str(e)}"}
    
    def _is_datetime_like(self, value: Any) -> bool:
        """Check if value is a datetime-like object."""
        return isinstance(value, (datetime, str)) or hasattr(value, 'isoformat')
    
    def _normalize_field_name(self, data: Dict[str, Any], field_name: str) -> str:
        """Normalize field names for MongoDB/Snowflake compatibility."""
        if field_name in data:
            return data[field_name]
        upper_name = field_name.upper()
        if upper_name in data:
            return data[upper_name]
        if field_name.lower() in data:
            return data[field_name.lower()]
        return None
    
    def _get_safe(self, data: Dict[str, Any], *keys: str, default: Any = None) -> Any:
        """Safely get nested values with MongoDB/Snowflake field name compatibility."""
        current = data
        for key in keys:
            if isinstance(current, dict):
                if key in current:
                    current = current[key]
                elif key.upper() in current:
                    current = current[key.upper()]
                elif key.lower() in current:
                    current = current[key.lower()]
                else:
                    return default
            else:
                return default
        return current if current is not None else default
    
    def _analyze_single_session(self, session: Dict) -> Dict[str, Any]:
        """Extract and summarize a single session."""
        reps = session.get("reps", [])
        rep_count = len(reps)
        
        if rep_count == 0:
            return {"rep_count": 0, "checks_summary": {}}
        
        # Aggregate check results
        checks_summary = {}
        for check_name in ["depth", "knee_tracking", "torso_angle", "heel_lift", "asymmetry"]:
            severities = []
            for rep in reps:
                check = rep.get("checks", {}).get(check_name, {})
                severity = check.get("severity", "low")
                severities.append(severity)
            
            flag_count = severities.count("high")
            watch_count = severities.count("moderate")
            ok_count = severities.count("low")
            
            checks_summary[check_name] = {
                "ok": ok_count,
                "watch": watch_count,
                "flag": flag_count,
                "flag_percentage": round((flag_count / rep_count * 100) if rep_count > 0 else 0, 1),
            }
        
        return {
            "rep_count": rep_count,
            "checks_summary": checks_summary,
        }
    
    def _identify_weak_areas(self, session: Dict) -> List[Dict[str, Any]]:
        """Identify form checks that need the most attention."""
        reps = session.get("reps", [])
        weak_areas = []
        
        check_scores = {}
        for check_name in ["depth", "knee_tracking", "torso_angle", "heel_lift", "asymmetry"]:
            total_score = 0
            for rep in reps:
                check = rep.get("checks", {}).get(check_name, {})
                severity = check.get("severity", "low")
                total_score += self.severity_weights.get(severity, 0)
            
            avg_score = total_score / len(reps) if reps else 0
            check_scores[check_name] = avg_score
        
        # Sort by severity
        for check_name, score in sorted(check_scores.items(), key=lambda x: x[1], reverse=True):
            if score > 0:
                # Get evidence from worst rep for this check
                worst_rep_evidence = None
                worst_rep_severity = "low"
                for rep in reps:
                    check = rep.get("checks", {}).get(check_name, {})
                    if self.severity_weights.get(check.get("severity", "low"), 0) > self.severity_weights.get(worst_rep_severity, 0):
                        worst_rep_severity = check.get("severity", "low")
                        worst_rep_evidence = check.get("evidence", {})
                
                weak_areas.append({
                    "check": check_name,
                    "severity_score": round(score, 2),
                    "worst_severity": worst_rep_severity,
                    "evidence": worst_rep_evidence or {},
                    "cue": self._get_cue_for_check(check_name, worst_rep_severity),
                })
        
        return weak_areas[:5]  # Top 5 weak areas
    
    def _calculate_consistency(self, session: Dict) -> Dict[str, Any]:
        """Calculate how consistent the reps were."""
        reps = session.get("reps", [])
        
        if len(reps) < 2:
            return {"consistency_score": 1.0, "interpretation": "Insufficient data"}
        
        # Calculate variance in check results across reps
        check_variances = {}
        for check_name in ["depth", "knee_tracking", "torso_angle", "heel_lift", "asymmetry"]:
            scores = []
            for rep in reps:
                check = rep.get("checks", {}).get(check_name, {})
                severity = check.get("severity", "low")
                scores.append(self.severity_weights.get(severity, 0))
            
            if len(set(scores)) > 1:  # If there's variance
                variance = stdev(scores)
                check_variances[check_name] = variance
        
        # Average variance across all checks
        avg_variance = mean(check_variances.values()) if check_variances else 0
        
        # Convert variance to consistency score (0-1, where 1 = perfect consistency)
        # Max variance expected is ~2, so normalize
        consistency_score = max(0, 1 - (avg_variance / 2.5))
        
        interpretation = "Excellent" if consistency_score > 0.8 else \
                        "Good" if consistency_score > 0.6 else \
                        "Fair" if consistency_score > 0.4 else "Needs improvement"
        
        return {
            "consistency_score": round(consistency_score, 2),
            "interpretation": interpretation,
            "check_variances": {k: round(v, 2) for k, v in check_variances.items()},
        }
    
    def _calculate_trends(self, history: List[Dict]) -> Dict[str, Any]:
        """Calculate form trends over recent sessions."""
        if len(history) < 2:
            return {
                "trend": "insufficient_data",
                "interpretation": "Need more sessions to detect trends",
                "rep_trend": None,
            }
        
        # Sort by timestamp (oldest first)
        sorted_history = sorted(history, key=lambda x: x.get("timestamp", datetime.now(timezone.utc)))
        
        # Analyze trend in check failures across sessions
        check_failure_trend = {}
        for check_name in ["depth", "knee_tracking", "torso_angle", "heel_lift", "asymmetry"]:
            failure_rates = []
            for session in sorted_history[:5]:  # Last 5 sessions
                reps = session.get("reps", [])
                failures = sum(1 for rep in reps 
                             if rep.get("checks", {}).get(check_name, {}).get("severity") == "high")
                failure_rate = (failures / len(reps) * 100) if reps else 0
                failure_rates.append(failure_rate)
            
            if len(failure_rates) > 1:
                trend = "improving" if failure_rates[-1] < failure_rates[0] else \
                       "degrading" if failure_rates[-1] > failure_rates[0] else "stable"
                change = failure_rates[-1] - failure_rates[0]
                check_failure_trend[check_name] = {
                    "trend": trend,
                    "change": round(change, 1),
                }
        
        # Overall rep count trend
        rep_counts = [s.get("rep_count", 0) for s in sorted_history[:5]]
        rep_trend = "increasing" if len(rep_counts) > 1 and rep_counts[-1] > rep_counts[0] else \
                    "decreasing" if len(rep_counts) > 1 and rep_counts[-1] < rep_counts[0] else "stable"
        
        return {
            "check_failure_trends": check_failure_trend,
            "rep_count_trend": rep_trend,
            "interpretation": self._interpret_trends(check_failure_trend, rep_trend),
        }
    
    def _compare_to_history(self, current_session: Dict, history: List[Dict]) -> Dict[str, Any]:
        """Compare current session to historical average."""
        if len(history) < 2:
            return {"comparison": "insufficient_data"}
        
        # Exclude current session from average
        history_exclude_current = [s for s in history[1:]]
        
        current_reps = current_session.get("rep_count", 0)
        avg_reps = mean([s.get("rep_count", 0) for s in history_exclude_current]) if history_exclude_current else 0
        
        current_flags = sum(1 for rep in current_session.get("reps", [])
                           for check in rep.get("checks", {}).values()
                           if check.get("severity") == "high")
        
        avg_flags = mean([
            sum(1 for rep in s.get("reps", [])
                for check in rep.get("checks", {}).values()
                if check.get("severity") == "high")
            for s in history_exclude_current
        ]) if history_exclude_current else 0
        
        return {
            "rep_count": {
                "current": current_reps,
                "historical_avg": round(avg_reps, 1),
                "vs_avg": round(current_reps - avg_reps, 1),
            },
            "critical_issues": {
                "current": current_flags,
                "historical_avg": round(avg_flags, 1),
                "vs_avg": round(current_flags - avg_flags, 1),
            },
        }
    
    def _interpret_trends(self, check_trends: Dict, rep_trend: str) -> str:
        """Generate a human-readable interpretation of trends."""
        improving_checks = sum(1 for v in check_trends.values() if v["trend"] == "improving")
        degrading_checks = sum(1 for v in check_trends.values() if v["trend"] == "degrading")
        
        if improving_checks > degrading_checks and rep_trend == "increasing":
            return "🎯 Great progress! Form is improving and stamina is increasing."
        elif degrading_checks > improving_checks and rep_trend == "decreasing":
            return "⚠️ Form is degrading. Consider shorter sets or more rest."
        elif improving_checks > degrading_checks:
            return "✅ Form is improving! Keep up the momentum."
        elif degrading_checks > improving_checks:
            return "⚠️ Some form areas are declining. May indicate fatigue."
        else:
            return "📊 Form is stable. Maintain current technique."
    
    def _generate_recommendations(self, weak_areas: List[Dict], trends: Dict) -> List[str]:
        """Generate actionable recommendations based on analysis."""
        recommendations = []
        
        # Top weak areas
        if weak_areas:
            top_weak = weak_areas[0]
            check_name = top_weak["check"]
            check_label = check_name.replace("_", " ").title()
            
            if top_weak["worst_severity"] == "high":
                recommendations.append(f"🔴 Priority: Fix {check_label} - this is causing major form breaks.")
            elif top_weak["worst_severity"] == "moderate":
                recommendations.append(f"🟡 Work on {check_label} - several reps showed issues here.")
        
        # Trend-based recommendations
        check_trends = trends.get("check_failure_trends", {})
        for check_name, trend_info in check_trends.items():
            if trend_info["trend"] == "degrading" and trend_info["change"] > 10:
                check_label = check_name.replace("_", " ").title()
                recommendations.append(f"🛑 Stop degrading {check_label}. Take breaks between sets.")
        
        # Rep count trend
        if trends.get("rep_count_trend") == "decreasing":
            recommendations.append("💪 Aiming for more reps? Focus on form quality over quantity first.")
        elif trends.get("rep_count_trend") == "increasing":
            recommendations.append("🚀 Excellent! You're building stamina. Maintain form quality.")
        
        # Generic tips
        if not recommendations:
            recommendations.append("✨ Keep consistent with form checks between sets.")
        
        recommendations.append("📹 Record your sets to compare form visually over time.")
        
        return recommendations[:5]  # Limit to 5 recommendations
    
    def _get_cue_for_check(self, check_name: str, severity: str) -> str:
        """Get a coaching cue for a specific check and severity."""
        cues = {
            "depth": {
                "high": "Squat deeper - aim for hip crease below knee level.",
                "moderate": "Increase depth slightly for better muscle engagement.",
                "low": "Great depth control!",
            },
            "knee_tracking": {
                "high": "Knees are caving inward (valgus). Push them out over your toes.",
                "moderate": "Watch for slight knee inward drift - keep them stable.",
                "low": "Excellent knee tracking!",
            },
            "torso_angle": {
                "high": "Your torso is leaning too far forward. Brace your core, stay upright.",
                "moderate": "Slight forward lean detected. Keep your chest proud.",
                "low": "Perfect torso position!",
            },
            "heel_lift": {
                "high": "Heels are lifting - shift weight to mid-foot. Consider heel-elevated shoes.",
                "moderate": "Minor heel lift visible. Focus on weight distribution.",
                "low": "Excellent heel stability!",
            },
            "asymmetry": {
                "high": "Major imbalance between left and right. Correct asymmetry before increasing load.",
                "moderate": "Slight side-to-side imbalance. Work on symmetry.",
                "low": "Perfect symmetry!",
            },
        }
        
        return cues.get(check_name, {}).get(severity, "Keep working on this area.")

# Global analyzer instance
analyzer = FormAnalyzer()
