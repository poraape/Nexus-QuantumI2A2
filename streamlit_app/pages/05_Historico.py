from __future__ import annotations

import json
from io import BytesIO

import pandas as pd
import streamlit as st

from ..services.exporting import export_documents_dataframe
from ..state import append_log, ensure_state

st.set_page_config(page_title="Histórico & Logs", page_icon="🗂️")
state = ensure_state()

st.title("🗂️ Histórico de análises e logs")

if state.analysis_history:
    st.markdown("### Histórico de relatórios")
    history_rows = []
    for report in state.analysis_history:
        summary = report.get("summary", {})
        history_rows.append(
            {
                "Título": summary.get("title"),
                "Gerado em": report.get("generatedAt"),
                "Documentos": len(report.get("documents", []) or []),
                "Insights": len(report.get("incrementalInsights", []) or []),
            }
        )
    history_df = pd.DataFrame(history_rows)
    st.dataframe(history_df, use_container_width=True)
    csv_buffer = BytesIO()
    history_df.to_csv(csv_buffer, index=False)
    st.download_button("Exportar histórico CSV", csv_buffer.getvalue(), "historico-analises.csv", mime="text/csv")
else:
    st.info("Nenhum histórico disponível ainda.")

st.markdown("### Logs de execução")
if state.logs:
    logs_df = pd.DataFrame(state.logs)
    st.dataframe(logs_df.sort_values("timestamp", ascending=False), use_container_width=True)
    st.download_button(
        "Exportar logs JSON",
        json.dumps(state.logs, indent=2, ensure_ascii=False).encode("utf-8"),
        "logs-mas.json",
        mime="application/json",
    )
else:
    st.info("Os logs são preenchidos conforme ações são executadas no front-end Streamlit.")

if state.job.result:
    st.markdown("### Exportação rápida de documentos do relatório atual")
    docs_df = export_documents_dataframe(state.job.result)
    if not docs_df.empty:
        st.dataframe(docs_df, use_container_width=True)
        docs_buffer = BytesIO()
        docs_df.to_excel(docs_buffer, index=False)
        st.download_button(
            "Baixar planilha de documentos",
            docs_buffer.getvalue(),
            "documentos-atual.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

st.markdown("### Anotações manuais")
note = st.text_area("Registrar uma anotação para auditoria futura")
if st.button("Salvar anotação") and note:
    append_log(
        {
            "level": "INFO",
            "message": note,
            "timestamp": pd.Timestamp.utcnow().isoformat(),
            "scope": "manual-note",
        }
    )
    st.success("Anotação registrada nos logs locais.")
