"""Session state helpers for the Streamlit migration."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import streamlit as st


DEFAULT_BACKEND_URL = "http://localhost:8000"
DEFAULT_API_PREFIX = "/api"
DEFAULT_MAS_URL = "http://localhost:4000"


@dataclass
class AuthState:
    expires_at: Optional[float] = None
    session_active: bool = False


@dataclass
class AgentState:
    status: str = "pending"
    step: str = ""
    current: int = 0
    total: int = 0


@dataclass
class JobState:
    job_id: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None
    agent_states: Dict[str, AgentState] = field(default_factory=dict)
    result: Optional[Dict[str, Any]] = None
    last_update_at: Optional[str] = None


@dataclass
class ChatState:
    session_id: Optional[str] = None
    initialized_for_job: Optional[str] = None
    messages: List[Dict[str, Any]] = field(default_factory=list)
    pending: bool = False


@dataclass
class AppState:
    backend_url: str = DEFAULT_BACKEND_URL
    backend_api_prefix: str = DEFAULT_API_PREFIX
    mas_url: str = DEFAULT_MAS_URL
    auth: AuthState = field(default_factory=AuthState)
    job: JobState = field(default_factory=JobState)
    chat: ChatState = field(default_factory=ChatState)
    last_notification: Optional[str] = None
    logs: List[Dict[str, Any]] = field(default_factory=list)
    analysis_history: List[Dict[str, Any]] = field(default_factory=list)
    preferences: Dict[str, Any] = field(default_factory=dict)


SESSION_KEY = "streamlit_app_state"


def ensure_state() -> AppState:
    """Ensure a namespaced state object exists in ``st.session_state``."""
    if SESSION_KEY not in st.session_state:
        st.session_state[SESSION_KEY] = AppState()
    return st.session_state[SESSION_KEY]


def reset_job_state() -> None:
    state = ensure_state()
    state.job = JobState()
    state.chat = ChatState()


def append_log(entry: Dict[str, Any]) -> None:
    state = ensure_state()
    state.logs.append(entry)


def set_backend_url(url: str, api_prefix: str | None = None) -> None:
    state = ensure_state()
    state.backend_url = url.rstrip("/") or DEFAULT_BACKEND_URL
    if api_prefix is not None:
        normalized = api_prefix if api_prefix.startswith("/") else f"/{api_prefix}"
        state.backend_api_prefix = normalized.rstrip("/") or DEFAULT_API_PREFIX


def set_mas_url(url: str) -> None:
    state = ensure_state()
    state.mas_url = url.rstrip("/") or DEFAULT_MAS_URL


def set_auth_session(expires_at: float | None, active: bool) -> None:
    state = ensure_state()
    state.auth = AuthState(expires_at=expires_at, session_active=active)


def update_job(payload: Dict[str, Any]) -> None:
    state = ensure_state()
    job = state.job
    job.job_id = payload.get("jobId", job.job_id)
    job.status = payload.get("status", job.status)
    job.error = payload.get("error")
    if "result" in payload and payload["result"]:
        job.result = payload["result"]
        if payload["result"] not in state.analysis_history:
            state.analysis_history.append(payload["result"])
    if payload.get("agentStates"):
        agent_states: Dict[str, Any] = payload["agentStates"]
        normalized: Dict[str, AgentState] = {}
        for name, raw_state in agent_states.items():
            progress = raw_state.get("progress", {}) if isinstance(raw_state, dict) else {}
            normalized[name] = AgentState(
                status=raw_state.get("status", "pending"),
                step=progress.get("step", ""),
                current=progress.get("current", 0),
                total=progress.get("total", 0),
            )
        job.agent_states = normalized
    job.last_update_at = payload.get("updatedAt") or payload.get("createdAt") or job.last_update_at


def store_chat_message(message: Dict[str, Any]) -> None:
    state = ensure_state()
    state.chat.messages.append(message)
    if state.job.result is not None:
        history = state.job.result.setdefault("chatLog", [])
        if isinstance(history, list):
            history.append(message)


def set_chat_session(session_id: str, job_id: Optional[str] = None) -> None:
    state = ensure_state()
    state.chat.session_id = session_id
    state.chat.initialized_for_job = job_id or state.job.job_id
    state.chat.pending = False


def set_chat_pending(flag: bool) -> None:
    state = ensure_state()
    state.chat.pending = flag
