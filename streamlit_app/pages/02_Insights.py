from __future__ import annotations

import altair as alt
import pandas as pd
import streamlit as st

from ..state import ensure_state

st.set_page_config(page_title="Insights & Inteligência", page_icon="💡")
state = ensure_state()

st.title("💡 Insights incrementais e validações")

if not state.job.result:
    st.info("Nenhuma análise concluída ainda. Execute o pipeline para visualizar insights.")
    st.stop()

result = state.job.result
insights = result.get("incrementalInsights", []) or []
validations = result.get("crossValidation", []) or []
metrics = result.get("aggregatedMetrics", {}) or {}

if insights:
    st.markdown("### Últimos insights gerados")
    for insight in insights:
        with st.container(border=True):
            st.subheader(insight.get("title", "Insight"))
            st.write(insight.get("description", ""))
            if insight.get("severity"):
                st.caption(f"Severidade: {insight['severity']}")
            if insight.get("category"):
                st.caption(f"Categoria: {insight['category']}")
            evidence = insight.get("evidence") or []
            if evidence:
                st.write("Evidências:")
                st.write(", ".join(evidence))
else:
    st.warning("Nenhum insight incremental disponível ainda.")

st.markdown("### Validações cruzadas")
if validations:
    for validation in validations:
        with st.container(border=True):
            st.markdown(f"**{validation.get('attribute', 'Atributo')}**")
            st.write(validation.get("finding", ""))
            diff = validation.get("difference")
            if diff is not None:
                st.metric("Diferença detectada", diff)
else:
    st.info("Aguardando resultados de validação cruzada dos agentes.")

if metrics:
    st.markdown("### Visualização interativa de métricas")
    metric_df = pd.DataFrame([metrics]).melt(var_name="Métrica", value_name="Valor")
    chart = alt.Chart(metric_df).mark_bar(cornerRadius=6).encode(
        x="Valor:Q",
        y=alt.Y("Métrica:N", sort="-x"),
        tooltip=["Métrica", "Valor"],
    ).interactive()
    st.altair_chart(chart, use_container_width=True)

if state.chat.messages:
    st.markdown("### Histórico do chat analítico")
    for message in state.chat.messages:
        role = "👤" if message.get("sender") == "user" else "🤖"
        st.write(f"{role} {message.get('text')}")
        chart_data = message.get("chartData")
        if chart_data:
            chart_df = pd.DataFrame(chart_data.get("data", []))
            if not chart_df.empty:
                base = alt.Chart(chart_df).encode(
                    x="label:N",
                    y="value:Q",
                    tooltip=list(chart_df.columns),
                )
                chart_type = chart_data.get("type", "bar")
                if chart_type == "line":
                    chart = base.mark_line(point=True)
                elif chart_type == "scatter":
                    chart = base.encode(x="x:Q", y="value:Q").mark_circle(size=80)
                elif chart_type == "pie":
                    chart = base.mark_arc().encode(theta="value:Q", color="label:N")
                else:
                    chart = base.mark_bar(cornerRadius=6)
                st.altair_chart(chart.properties(title=chart_data.get("title")), use_container_width=True)
