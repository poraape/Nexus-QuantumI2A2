"""Streamlit front-end for the Nexus MAS platform."""
from __future__ import annotations

from datetime import datetime
from typing import List

import pandas as pd
import streamlit as st

from .services.backend import BackendError, ensure_session
from .services.exporting import (
    export_as_doc,
    export_as_excel,
    export_as_json,
    export_as_pdf,
    export_documents_dataframe,
)
from .state import (
    append_log,
    ensure_state,
    reset_job_state,
    set_auth_session,
    set_backend_url,
    set_mas_url,
    store_chat_message,
    update_job,
)
from .utils.clients import get_backend_client
from .utils.layout import render_agent_grid, render_header, render_metrics


st.set_page_config(page_title="Nexus MAS Streamlit", page_icon="🧠", layout="wide")
st.markdown(
    """
    <style>
        .stApp header { visibility: hidden; }
        section[data-testid="stSidebar"] > div { padding-top: 1.5rem; }
    </style>
    """,
    unsafe_allow_html=True,
)

state = ensure_state()
backend_client = get_backend_client()

with st.sidebar:
    st.title("⚙️ Configuração")
    backend_url_input = st.text_input("Backend FastAPI", state.backend_url)
    api_prefix_input = st.text_input("Prefixo API", state.backend_api_prefix)
    mas_url_input = st.text_input("Serviço MAS (Node)", state.mas_url)
    if st.button("Aplicar Endpoints"):
        set_backend_url(backend_url_input, api_prefix_input)
        set_mas_url(mas_url_input)
        st.success("Configurações atualizadas. Reiniciando visão geral...")
        st.experimental_rerun()

    st.divider()
    if not state.auth.session_active:
        if st.button("Estabelecer sessão segura", use_container_width=True):
            with st.spinner("Criando sessão autenticada..."):
                try:
                    response = ensure_session(backend_client)
                except BackendError as err:
                    st.error(f"Falha ao autenticar: {err}")
                else:
                    expires = None
                    if response and "expiresAt" in response:
                        expires = float(response["expiresAt"]) / 1000.0
                    set_auth_session(expires, True)
                    st.success("Sessão ativa.")
    else:
        if state.auth.expires_at:
            expires_dt = datetime.fromtimestamp(state.auth.expires_at)
            st.caption(f"Sessão expira em {expires_dt:%d/%m/%Y %H:%M:%S}")
        if st.button("Encerrar sessão", use_container_width=True):
            set_auth_session(None, False)
            reset_job_state()
            st.info("Sessão invalidada.")
            st.experimental_rerun()

render_header(state)

if state.job.job_id and state.job.status not in {"completed", "failed"}:
    try:
        session_info = ensure_session(backend_client)
        if session_info and "expiresAt" in session_info:
            set_auth_session(float(session_info["expiresAt"]) / 1000.0, True)
        payload = backend_client.get_job(state.job.job_id)
    except BackendError as err:
        st.warning(f"Falha ao sincronizar status do job: {err}")
    else:
        update_job(payload)

with st.expander("📦 Upload de arquivos e orquestração", expanded=not state.job.job_id):
    uploaded_files = st.file_uploader(
        "Envie XMLs, CSVs ou planilhas para auditoria fiscal",
        accept_multiple_files=True,
        type=["xml", "csv", "xlsx", "xls", "pdf", "json", "zip"],
    )
    webhook_url = st.text_input("Webhook opcional para notificações", state.preferences.get("webhook_url"))
    col_a, col_b, col_c = st.columns(3)
    with col_a:
        start_analysis = st.button("▶️ Iniciar análise", disabled=not uploaded_files)
    with col_b:
        refresh_status = st.button("🔄 Atualizar progresso", disabled=not state.job.job_id)
    with col_c:
        reset_flow = st.button("🧹 Reiniciar fluxo", disabled=not state.job.job_id)

    if start_analysis and uploaded_files:
        try:
            session_info = ensure_session(backend_client)
            if session_info and "expiresAt" in session_info:
                set_auth_session(float(session_info["expiresAt"]) / 1000.0, True)
            payload = backend_client.start_analysis(uploaded_files, webhook_url or None)
        except BackendError as err:
            st.error(f"Não foi possível iniciar a análise: {err}")
        else:
            update_job(payload)
            state.preferences["webhook_url"] = webhook_url
            append_log(
                {
                    "level": "INFO",
                    "message": "Análise iniciada via Streamlit",
                    "timestamp": datetime.utcnow().isoformat(),
                    "agent": "frontend",
                }
            )
            st.toast("Pipeline fiscal iniciado com sucesso!", icon="✅")
            st.experimental_rerun()

    if refresh_status and state.job.job_id:
        try:
            session_info = ensure_session(backend_client)
            if session_info and "expiresAt" in session_info:
                set_auth_session(float(session_info["expiresAt"]) / 1000.0, True)
            payload = backend_client.get_job(state.job.job_id)
            update_job(payload)
            append_log(
                {
                    "level": "INFO",
                    "message": "Status do job atualizado manualmente",
                    "timestamp": datetime.utcnow().isoformat(),
                    "agent": "frontend",
                }
            )
        except BackendError as err:
            st.warning(f"Falha ao atualizar progresso: {err}")

    if reset_flow:
        reset_job_state()
        append_log(
            {
                "level": "WARN",
                "message": "Fluxo reiniciado pelo usuário",
                "timestamp": datetime.utcnow().isoformat(),
                "agent": "frontend",
            }
        )
        st.toast("Pipeline reiniciado.", icon="♻️")
        st.experimental_rerun()

if state.job.job_id:
    st.info(f"Job atual: {state.job.job_id}")

if state.job.error:
    st.error(state.job.error)

render_agent_grid(state.job.agent_states)

if state.job.result:
    result = state.job.result
    summary = result.get("summary", {})
    st.subheader(summary.get("title", "Resumo da análise fiscal"))
    st.write(summary.get("overview", ""))

    render_metrics(summary.get("keyMetrics", []))

    aggregated = result.get("aggregatedMetrics", {})
    if aggregated:
        st.markdown("### Métricas agregadas")
        metrics_df = pd.DataFrame([aggregated]).T
        metrics_df.columns = ["Valor"]
        st.dataframe(metrics_df, use_container_width=True)

    tabs = st.tabs(["Documentos", "Insights", "Exportações"])
    with tabs[0]:
        docs_df = export_documents_dataframe(result)
        st.dataframe(docs_df, use_container_width=True, height=320)
    with tabs[1]:
        incremental = result.get("incrementalInsights", [])
        if not incremental:
            st.info("Insights incrementais serão exibidos após novas execuções.")
        for insight in incremental:
            with st.container(border=True):
                st.markdown(f"**{insight.get('title', 'Insight')}**")
                st.write(insight.get("description", ""))
                meta = insight.get("metadata", {})
                if meta:
                    st.caption("Contexto adicional")
                    st.json(meta, expanded=False)
    with tabs[2]:
        col1, col2, col3, col4 = st.columns(4)
        json_name, json_bytes = export_as_json(result)
        col1.download_button("JSON", json_bytes, json_name, mime="application/json")
        xlsx_name, xlsx_bytes = export_as_excel(result)
        col2.download_button("Excel", xlsx_bytes, xlsx_name, mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        pdf_name, pdf_bytes = export_as_pdf(result)
        col3.download_button("PDF", pdf_bytes, pdf_name, mime="application/pdf")
        doc_name, doc_bytes = export_as_doc(result)
        col4.download_button("DOCX", doc_bytes, doc_name, mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document")

else:
    st.info("Inicie uma análise para visualizar resultados consolidados e exportações.")

if state.analysis_history:
    st.markdown("### Histórico recente")
    history_items: List[str] = []
    for past in reversed(state.analysis_history[-5:]):
        title = past.get("summary", {}).get("title", "Relatório")
        timestamp = past.get("generatedAt") or state.job.last_update_at
        history_items.append(f"• {title} ({timestamp or 'sem data'})")
    st.markdown("\n".join(history_items))

# Garantir que o chat tenha registros suficientes para exportação futura
if state.job.result and not state.job.result.get("chatLog"):
    store_chat_message(
        {
            "id": "chat-placeholder",
            "sender": "ai",
            "text": "O chat será ativado na página dedicada após concluir a análise.",
        }
    )
