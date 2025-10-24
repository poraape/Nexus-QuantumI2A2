# Observabilidade Local e Revisões Automatizadas

Este guia descreve como consolidar métricas coletadas em tempo de execução, gerar
relatórios agendados para revisões e habilitar dashboards locais alimentados pelo
backend do Nexus QuantumI2A2.

## 📈 Coleta de métricas em memória

* O serviço `app.services.monitoring.metrics_collector` mantém, em memória, os
  indicadores por agente (latência média, taxa de erros, throughput e número de
  tentativas). Sempre que um agente executa, o `EfficiencyGuard` avalia os
  thresholds configurados em `backend/app/config.py` e aplica ajustes
  automáticos — como aumento de timeout, ativação de modo de recuperação ou
  recomendações de batching — sem necessidade de intervenção manual.
* As decisões aplicadas ficam disponíveis via `metrics_collector.get_adjustments()`
  e são persistidas nos relatórios gerados automaticamente.

## 🗂️ Relatórios agendados

Use o gerador de relatórios para consolidar os dados em um formato consumível
pelas equipes de auditoria ou para anexos em pipelines de CI/CD:

```bash
python -m app.services.audit.report_generator --schedule nightly --output reports/monitoring
```

O comando acima gera um arquivo JSON contendo métricas agregadas, ajustes
aplicados pelo `EfficiencyGuard` e um sumário com contagem de agentes e média de
latência. A CLI aceita `--filename` para controlar o nome final do artefato.

## 📊 Dashboards locais

Para dashboards em notebooks ou ferramentas como Superset/Grafana rodando
localmente, consuma o endpoint FastAPI exposto em tempo de execução:

```
GET http://localhost:8000/api/monitoring/metrics
```

### Formatos disponíveis

* `?format=json` (padrão): retorna o payload completo com métricas e decisões do
  guardião de eficiência.
* `?format=csv&download=1`: exporta uma planilha CSV pronta para importação em
  planilhas ou em dashboards improvisados.

## 🔄 Integração com revisões de código

Os relatórios gerados podem ser anexados aos scripts existentes de revisão
(`scripts/publishQualityReport.mjs`) adicionando o arquivo JSON como artefato no
pipeline. Recomenda-se executar o gerador antes da etapa de upload para manter a
linha do tempo de métricas alinhada com cada execução do CI.

## 🔐 Thresholds configuráveis

* Ajuste os limites no `.env` usando a variável `EFFICIENCY_THRESHOLDS` (JSON) ou
  altere os valores padrão em `backend/app/config.py`.
* Controle o comportamento do guardião com `EFFICIENCY_GUARD_ENABLED`,
  `EFFICIENCY_GUARD_MAX_TIMEOUT_MS` e `EFFICIENCY_GUARD_TIMEOUT_STEP_MS` para
  calibrar os ajustes automáticos.

