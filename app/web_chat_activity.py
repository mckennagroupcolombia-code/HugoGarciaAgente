"""Persistencia de chats web (widget Hugo) para panel y métricas."""

import json
import os
import threading
from datetime import datetime, timedelta
from typing import Any

_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "web_chat_activity.json")
_LOCK = threading.Lock()
_MAX_RECENT_TURNS = 10
_MAX_SESSIONS = 500


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _today_key() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")[:19])
    except ValueError:
        return None


def _load() -> dict[str, Any]:
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("updated_at", _now_iso())
    data.setdefault("daily_counts", {})
    data.setdefault("sessions", [])
    if not isinstance(data["daily_counts"], dict):
        data["daily_counts"] = {}
    if not isinstance(data["sessions"], list):
        data["sessions"] = []
    return data


def _save(data: dict[str, Any]) -> None:
    data["updated_at"] = _now_iso()
    os.makedirs(os.path.dirname(_DATA_PATH), exist_ok=True)
    with open(_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _find_session(sessions: list[dict], session_id: str) -> dict | None:
    for s in sessions:
        if str(s.get("session_id")) == str(session_id):
            return s
    return None


def record_interaction(
    *,
    session_id: str,
    user_message: str,
    agent_reply: str,
    attachments_count: int = 0,
    source: str = "agent",
    page_url: str = "",
    user_agent: str = "",
    upstream_error: str = "",
) -> None:
    session_id = (session_id or "").strip()
    if not session_id:
        return
    now = _now_iso()
    turn = {
        "at": now,
        "user_message": (user_message or "")[:4000],
        "agent_reply": (agent_reply or "")[:8000],
        "attachments_count": int(attachments_count or 0),
        "source": (source or "agent")[:64],
        "upstream_error": (upstream_error or "")[:500],
    }
    with _LOCK:
        data = _load()
        sessions: list[dict] = data["sessions"]
        session = _find_session(sessions, session_id)
        if session is None:
            session = {
                "session_id": session_id,
                "started_at": now,
                "last_at": now,
                "messages_count": 0,
                "attachments_count": 0,
                "reviewed": False,
                "reviewed_at": None,
                "page_url": (page_url or "")[:2000],
                "user_agent": (user_agent or "")[:500],
                "last_user_message": "",
                "last_agent_reply": "",
                "last_source": source,
                "last_upstream_error": "",
                "recent_turns": [],
            }
            sessions.insert(0, session)
        session["last_at"] = now
        session["messages_count"] = int(session.get("messages_count") or 0) + 1
        session["attachments_count"] = int(session.get("attachments_count") or 0) + int(
            attachments_count or 0
        )
        if page_url:
            session["page_url"] = page_url[:2000]
        if user_agent:
            session["user_agent"] = user_agent[:500]
        session["last_user_message"] = turn["user_message"]
        session["last_agent_reply"] = turn["agent_reply"]
        session["last_source"] = turn["source"]
        session["last_upstream_error"] = turn["upstream_error"]
        turns = list(session.get("recent_turns") or [])
        turns.append(turn)
        session["recent_turns"] = turns[-_MAX_RECENT_TURNS:]
        day = _today_key()
        daily = data["daily_counts"]
        daily[day] = int(daily.get(day) or 0) + 1
        if len(sessions) > _MAX_SESSIONS:
            data["sessions"] = sessions[:_MAX_SESSIONS]
        _save(data)


def get_summary() -> dict[str, int]:
    with _LOCK:
        data = _load()
    today = _today_key()
    now = datetime.now()
    cutoff = now - timedelta(hours=24)
    sessions = data.get("sessions") or []
    unreviewed = 0
    active_24h = 0
    for s in sessions:
        if not s.get("reviewed"):
            unreviewed += 1
        last = _parse_dt(s.get("last_at"))
        if last and last >= cutoff:
            active_24h += 1
    return {
        "today_interactions": int((data.get("daily_counts") or {}).get(today) or 0),
        "unreviewed_count": unreviewed,
        "active_last_24h": active_24h,
    }


def get_panel_payload(*, limit: int = 40, only_unreviewed: bool = False) -> dict[str, Any]:
    limit = max(1, min(int(limit or 40), 200))
    with _LOCK:
        data = _load()
    sessions = list(data.get("sessions") or [])
    if only_unreviewed:
        sessions = [s for s in sessions if not s.get("reviewed")]
    sessions.sort(key=lambda s: s.get("last_at") or "", reverse=True)
    return {
        "updated_at": data.get("updated_at"),
        "summary": get_summary(),
        "sessions": sessions[:limit],
        "total_sessions": len(data.get("sessions") or []),
    }


def mark_session_reviewed(session_id: str) -> bool:
    with _LOCK:
        data = _load()
        session = _find_session(data["sessions"], session_id)
        if not session or session.get("reviewed"):
            return False
        session["reviewed"] = True
        session["reviewed_at"] = _now_iso()
        _save(data)
        return True


def mark_all_reviewed() -> int:
    with _LOCK:
        data = _load()
        count = 0
        now = _now_iso()
        for s in data.get("sessions") or []:
            if not s.get("reviewed"):
                s["reviewed"] = True
                s["reviewed_at"] = now
                count += 1
        if count:
            _save(data)
        return count
