from __future__ import annotations

import json
import pandas as pd
import streamlit as st

from ..services.backend import BackendError
from ..state import ensure_state
from ..utils.clients import get_integration_client

st.set_page_config(page_title="Integrações MAS", page_icon="🔗")
state = ensure_state()
client = get_integration_client()

st.title("🔗 Integrações com ERPs")

if "_integration_snapshot" not in st.session_state:
    st.session_state["_integration_snapshot"] = None

col1, col2 = st.columns([1, 3])
with col1:
    if st.button("Atualizar status", use_container_width=True):
        with st.spinner("Consultando MAS..."):
            try:
                snapshot = client.fetch_status()
                st.session_state["_integration_snapshot"] = snapshot
                st.success("Status atualizado.")
            except BackendError as err:
                st.error(f"Falha ao consultar integrações: {err}")
with col2:
    st.info(
        "Configure as credenciais de backend na barra lateral para acessar o serviço Node.js responsável pelas integrações."
    )

snapshot = st.session_state.get("_integration_snapshot")

if not snapshot:
    st.warning("Nenhum status carregado ainda. Clique em 'Atualizar status'.")
    st.stop()

statuses = snapshot.get("statuses", [])
if statuses:
    st.markdown("### Status por ERP")
    status_df = pd.DataFrame(statuses)
    st.dataframe(status_df, use_container_width=True)

history = snapshot.get("history", [])
if history:
    st.markdown("### Histórico de execuções")
    history_df = pd.DataFrame(history)
    st.dataframe(history_df.sort_values("timestamp", ascending=False), use_container_width=True, height=320)

st.markdown("### Disparar integrações manualmente")
with st.form("integration-form"):
    erp = st.selectbox("Canal", ["TINY", "BLING", "CONTA_AZUL"], index=0)
    action = st.radio("Ação", ["import", "export"], horizontal=True)
    company_id = st.text_input("Company ID", value="default")
    since = st.text_input("Desde (ISO 8601)", value="")
    payload = st.text_area("Payload JSON (opcional para export)", value="")
    submitted = st.form_submit_button("Enviar job", use_container_width=True)

if submitted:
    body = {"companyId": company_id}
    if since:
        body["since"] = since
    if action == "export" and payload:
        try:
            documents = json.loads(payload)
        except json.JSONDecodeError:
            st.error("Payload inválido. Utilize um JSON válido ou deixe em branco.")
            st.stop()
        else:
            if isinstance(documents, list):
                body["documents"] = documents
            else:
                st.error("O payload de exportação deve ser uma lista de documentos.")
                st.stop()
    try:
        if action == "import":
            response = client.enqueue_import(erp, body)
        else:
            response = client.enqueue_export(erp, body)
    except BackendError as err:
        st.error(f"Falha ao enviar job: {err}")
    else:
        st.success(f"Job {action} enfileirado: {response}")
