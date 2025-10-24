from __future__ import annotations

import pandas as pd
import streamlit as st

from ..state import ensure_state
from ..utils.layout import render_metrics

st.set_page_config(page_title="Relatório Fiscal", page_icon="📊")
state = ensure_state()

st.title("📊 Relatório Detalhado")

if not state.job.result:
    st.info("Execute uma análise na página inicial para liberar este relatório.")
    st.stop()

result = state.job.result
summary = result.get("summary", {})

st.subheader(summary.get("title", "Resumo fiscal"))
st.write(summary.get("overview", ""))

render_metrics(summary.get("keyMetrics", []))

col1, col2 = st.columns(2)
with col1:
    st.metric("Documentos processados", len(result.get("documents", []) or []))
with col2:
    st.metric("Inconsistências", sum(len(doc.get("inconsistencies", []) or []) for doc in result.get("documents", []) or []))

st.markdown("### Documentos auditados")
docs = []
for doc in result.get("documents", []) or []:
    meta = doc.get("doc", {}) if isinstance(doc, dict) else {}
    docs.append(
        {
            "Arquivo": meta.get("name"),
            "Tipo": meta.get("kind"),
            "Status": doc.get("status"),
            "Score": doc.get("score"),
            "Classificação": (doc.get("classification") or {}).get("operationType"),
            "Setor": (doc.get("classification") or {}).get("businessSector"),
            "Inconsistências": len(doc.get("inconsistencies", []) or []),
        }
    )
frame = pd.DataFrame(docs)
st.dataframe(frame, use_container_width=True)

st.markdown("### Inconsistências")
for doc in result.get("documents", []) or []:
    inconsistencies = doc.get("inconsistencies", []) or []
    if not inconsistencies:
        continue
    meta = doc.get("doc", {})
    with st.expander(f"{meta.get('name', 'Documento')} - {len(inconsistencies)} apontamentos"):
        for inc in inconsistencies:
            st.markdown(f"**{inc.get('code')} - {inc.get('severity')}**")
            st.write(inc.get("message"))
            st.caption(inc.get("explanation", ""))
            if inc.get("normativeBase"):
                st.caption(f"Base normativa: {inc['normativeBase']}")
            st.divider()

st.markdown("### Recomendações estratégicas")
for recommendation in summary.get("strategicRecommendations", []) or []:
    st.write(f"- {recommendation}")
