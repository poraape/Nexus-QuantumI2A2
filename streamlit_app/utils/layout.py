"""Shared layout helpers for the Streamlit UI."""
from __future__ import annotations

from typing import Dict, Iterable

import streamlit as st

from ..state import AgentState, AppState


def render_header(state: AppState) -> None:
    st.title("Nexus Fiscal Intelligence")
    st.caption(
        "Dashboard unificado de análises fiscais com orquestração multiagente."
    )
    status = state.job.status or "aguardando"
    pill_color = {
        "completed": "#0f766e",
        "running": "#2563eb",
        "queued": "#2563eb",
        "failed": "#dc2626",
    }.get(status.lower() if isinstance(status, str) else status, "#6b7280")
    st.markdown(
        f"<div style='display:flex;gap:0.5rem;align-items:center;'>"
        f"<span style='font-size:0.85rem;color:#9ca3af;'>Status atual:</span>"
        f"<span style='background:{pill_color};color:white;padding:0.25rem 0.75rem;border-radius:999px;text-transform:uppercase;font-weight:600;font-size:0.75rem;'>"
        f"{status}</span></div>",
        unsafe_allow_html=True,
    )


def render_agent_grid(agent_states: Dict[str, AgentState]) -> None:
    if not agent_states:
        st.info("Os agentes serão exibidos após o início de uma análise.")
        return

    cols = st.columns(3)
    for idx, (agent, agent_state) in enumerate(sorted(agent_states.items())):
        with cols[idx % 3]:
            card_color = {
                "completed": "#22c55e",
                "running": "#2563eb",
                "error": "#ef4444",
                "pending": "#6b7280",
            }.get(agent_state.status, "#0ea5e9")
            st.markdown(
                """
                <div style="background:linear-gradient(135deg, rgba(15,23,42,0.85), rgba(30,64,175,0.85));
                            border-radius:16px;padding:1rem 1.2rem;margin-bottom:1rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <h4 style="margin:0;color:white;font-size:1rem;text-transform:capitalize;">{title}</h4>
                        <span style="background:{color};color:white;padding:0.2rem 0.65rem;border-radius:999px;font-size:0.7rem;text-transform:uppercase;">{status}</span>
                    </div>
                    <p style="color:#cbd5f5;font-size:0.8rem;margin-top:0.75rem;">{step}</p>
                    <div style="background:#1f2937;border-radius:999px;height:8px;margin-top:0.5rem;">
                        <div style="width:{progress}%;height:100%;border-radius:999px;background:#38bdf8;"></div>
                    </div>
                </div>
                """.format(
                    title=agent.replace("_", " "),
                    color=card_color,
                    status=agent_state.status,
                    step=agent_state.step or "Aguardando eventos...",
                    progress=_progress(agent_state),
                ),
                unsafe_allow_html=True,
            )


def render_metrics(key_metrics: Iterable[Dict[str, str]]) -> None:
    metrics = list(key_metrics)
    if not metrics:
        st.warning("Métricas chave disponíveis após a conclusão da análise.")
        return

    cols = st.columns(min(3, len(metrics)))
    for idx, metric in enumerate(metrics):
        with cols[idx % len(cols)]:
            st.metric(metric.get("metric", "Métrica"), metric.get("value", "-"), metric.get("insight", ""))


def _progress(agent_state: AgentState) -> float:
    if agent_state.total == 0:
        return 0.0
    return min(100.0, (agent_state.current / agent_state.total) * 100)
