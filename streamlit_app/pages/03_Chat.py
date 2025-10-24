from __future__ import annotations

import streamlit as st

from ..state import ensure_state
from ..utils.chat import ensure_chat_session, send_message
from ..utils.clients import get_backend_client

st.set_page_config(page_title="Chat Fiscal", page_icon="💬")
state = ensure_state()
client = get_backend_client()

st.title("💬 Assistente fiscal inteligente")

if not state.job.result:
    st.info("Conclua uma análise para desbloquear o chat.")
    st.stop()

if ensure_chat_session(client):
    st.success("Sessão de chat inicializada.")

chat_container = st.container()
with chat_container:
    for message in state.chat.messages:
        avatar = "👤" if message.get("sender") == "user" else "🤖"
        st.markdown(f"{avatar} {message.get('text')}")
        chart_data = message.get("chartData")
        if chart_data:
            st.caption("Dados adicionais disponíveis nas páginas de insights.")

with st.form("chat-form"):
    user_message = st.text_area("Envie uma pergunta sobre a análise fiscal", height=120)
    submitted = st.form_submit_button("Enviar", use_container_width=True, disabled=not user_message or state.chat.pending)

if submitted and user_message:
    with st.spinner("Consultando agentes e LLM..."):
        response = send_message(client, user_message)
        if response:
            st.session_state["_last_chat_response"] = response
            st.experimental_rerun()

if state.chat.pending:
    st.info("Aguardando resposta do agente inteligente...")

if last_response := st.session_state.get("_last_chat_response"):
    st.markdown("### Última resposta estruturada")
    st.json(last_response, expanded=False)
