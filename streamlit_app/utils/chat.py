"""Chat helpers bridging the MAS chat endpoints to the Streamlit UI."""
from __future__ import annotations

import json
from typing import Any, Dict, List
from uuid import uuid4

import pandas as pd
import streamlit as st

from ..services.backend import BackendClient, BackendError, ensure_session
from ..state import ensure_state, set_chat_pending, set_chat_session, store_chat_message

CHAT_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": "Resposta textual para o usuário."},
        "chartData": {
            "type": ["object", "null"],
            "nullable": True,
            "properties": {
                "type": {"type": "string", "enum": ["bar", "pie", "line", "scatter"]},
                "title": {"type": "string"},
                "data": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "value": {"type": "number"},
                            "x": {"type": ["number", "null"]},
                        },
                        "required": ["label", "value"],
                    },
                },
                "xAxisLabel": {"type": ["string", "null"]},
                "yAxisLabel": {"type": ["string", "null"]},
            },
        },
    },
    "required": ["text"],
}


def _build_data_sample(report: Dict[str, Any]) -> str:
    frames: List[pd.DataFrame] = []
    for doc in report.get("documents", []) or []:
        data = (doc.get("doc") or {}).get("data")
        if data:
            try:
                frames.append(pd.DataFrame(data))
            except ValueError:
                continue
    if not frames:
        return ""
    combined = pd.concat(frames, ignore_index=True)
    head = combined.head(200)
    return head.to_csv(index=False)


def ensure_chat_session(client: BackendClient) -> bool:
    state = ensure_state()
    if not state.job.job_id or not state.job.result:
        st.warning("Inicie uma análise para habilitar o chat analítico.")
        return False
    if state.chat.session_id and state.chat.initialized_for_job == state.job.job_id:
        return True

    aggregated = state.job.result.get("aggregatedMetrics", {})
    data_sample = _build_data_sample(state.job.result)
    system_instruction = (
        "Você é um assistente especialista em análise fiscal. Utilize as métricas agregadas como fonte de verdade para totais "
        "e empregue a amostra de dados para perguntas detalhadas. Sempre proponha uma próxima ação ao concluir a resposta.\n"
        f"Métricas agregadas:\n{json.dumps(aggregated, indent=2, ensure_ascii=False)}\n"
        f"Amostra de dados (CSV):\n{data_sample}"
    )
    payload = {
        "model": "gemini-2.0-flash",
        "system_instruction": system_instruction,
        "schema": CHAT_RESPONSE_SCHEMA,
    }
    try:
        ensure_session(client)
        response = client.start_chat(payload)
    except BackendError as err:
        st.error(f"Falha ao criar sessão de chat: {err}")
        return False
    session_id = response.get("session_id")
    if not session_id:
        st.error("O backend não retornou um identificador de sessão válido.")
        return False
    set_chat_session(session_id, state.job.job_id)
    store_chat_message(
        {
            "id": "initial-ai-message",
            "sender": "ai",
            "text": "Sua análise fiscal está pronta. Faça uma pergunta para explorar os resultados.",
        }
    )
    return True


def send_message(client: BackendClient, message: str) -> Dict[str, Any] | None:
    state = ensure_state()
    if not state.chat.session_id:
        if not ensure_chat_session(client):
            return None
    session_id = state.chat.session_id
    if not session_id:
        return None
    store_chat_message({"id": str(uuid4()), "sender": "user", "text": message})
    set_chat_pending(True)
    try:
        ensure_session(client)
        response = client.send_chat(session_id, message)
    except BackendError as err:
        set_chat_pending(False)
        st.error(f"Falha ao enviar mensagem: {err}")
        return None
    payload = response.get("response", {}) if isinstance(response, dict) else {}
    text = payload.get("text") or json.dumps(payload, ensure_ascii=False)
    store_chat_message({"id": str(uuid4()), "sender": "ai", "text": text, "chartData": payload.get("chartData")})
    set_chat_pending(False)
    return payload
