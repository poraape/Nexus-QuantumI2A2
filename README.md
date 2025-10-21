# Nexus QuantumI2A2: Análise Fiscal com IA

**Nexus QuantumI2A2** é uma Single Page Application (SPA) de análise fiscal interativa que processa dados de Notas Fiscais Eletrônicas (NFe) e gera insights acionáveis através de um sistema de IA que simula múltiplos agentes especializados.

Esta aplicação demonstra uma arquitetura frontend completa e robusta, onde todo o processamento, desde o parsing de arquivos até a análise por IA, ocorre diretamente no navegador do cliente, combinando análise determinística com o poder de modelos de linguagem generativa (LLMs) para fornecer uma análise fiscal completa e um assistente de chat inteligente.

---

## ✨ Funcionalidades Principais

*   **Pipeline Multiagente Client-Side:** Uma cadeia de agentes especializados (Importação/OCR, Auditor, Classificador, Agente de Inteligência, Contador) processa os arquivos em etapas diretamente no navegador.
*   **Upload Flexível de Arquivos:** Suporte para múltiplos formatos, incluindo `XML`, `CSV`, `XLSX`, `PDF`, imagens (`PNG`, `JPG`) e arquivos `.ZIP` contendo múltiplos documentos.
*   **Análise Fiscal Aprofundada por IA:** Geração de um relatório detalhado com:
    *   **Resumo Executivo e Recomendações Estratégicas** gerados por IA.
    *   **Detecção de Anomalias por IA** que vai além de regras fixas.
    *   **Validação Cruzada (Cross-Validation)** entre documentos para encontrar discrepâncias sutis.
*   **Busca Inteligente (Smart Search):** Interaja com seus dados através de perguntas em linguagem natural diretamente no dashboard.
*   **Chat Interativo com IA:** Um assistente de IA, contextualizado com os dados do relatório, permite explorar os resultados e gera visualizações de dados sob demanda.
*   **Dashboards Dinâmicos:** Painéis interativos com KPIs, gráficos e filtros para uma visão aprofundada dos dados fiscais.
*   **Apuração Contábil e Geração de SPED/EFD:** Geração automática de lançamentos contábeis e de um arquivo de texto no layout simplificado do SPED Fiscal.
*   **Exportação de Relatórios:** Exporte a análise completa ou as conversas do chat para formatos como `PDF`, `DOCX`, `HTML` e `Markdown`.

---

## 🏗️ Arquitetura Atual: Frontend-Only com IA no Navegador

A implementação atual é uma demonstração poderosa de uma arquitetura totalmente client-side, executada no navegador do usuário.

### Frontend (Esta Aplicação)

A aplicação é uma SPA desenvolvida com **React** e **TypeScript**, utilizando **TailwindCSS** para estilização. Ela é responsável por:
*   Fornecer uma interface de usuário rica e interativa.
*   Executar o pipeline de agentes simulado no lado do cliente (`useAgentOrchestrator`).
*   Interagir **diretamente com a Google Gemini API** para capacidades de IA generativa (análise, chat, busca).
*   Utilizar bibliotecas como Tesseract.js e PDF.js (com Web Workers) para processamento pesado de arquivos em background sem travar a UI.
*   Renderizar dashboards, relatórios e o assistente de chat.

---

##  Blueprint para Backend de Produção

Para uma solução escalável em produção, a arquitetura pode evoluir para um sistema cliente-servidor, desacoplando a interface do processamento pesado.

#### Stack Tecnológico Sugerido
*   **Framework:** Python 3.11+ com FastAPI.
*   **Processamento Assíncrono:** Celery com RabbitMQ como message broker e Redis para cache.
*   **Orquestração de Agentes:** Orquestrador baseado em state machine (LangGraph opcional).
*   **Banco de Dados:** PostgreSQL para metadados, regras e logs de auditoria.
*   **Armazenamento de Arquivos:** S3-compatible (MinIO).
*   **Inteligência Artificial:** Google Gemini API (`gemini-2.5-flash`).
*   **Observabilidade:** Padrão OpenTelemetry (OTLP) para tracing, métricas e logs.

#### Sistema Multiagente no Backend

*   **Orquestrador:** Gerencia o fluxo de trabalho (Saga pattern), garantindo a execução resiliente e a compensação de falhas.
*   **ExtractorAgent:** Ingestão de dados brutos (XML, PDF, Imagens) via fila, usando OCR/parsing para extrair dados estruturados.
*   **AuditorAgent:** Aplica um motor de regras fiscais para validar os dados e calcula um score de risco.
*   **ClassifierAgent:** Categoriza os documentos por tipo de operação e setor.
*   **AccountantAgent:** Automatiza lançamentos contábeis, apura impostos e gera o arquivo SPED.
*   **IntelligenceAgent:** Gera insights gerenciais, alimenta o RAG para o chat e responde a simulações.

---

## ✅ Qualidade e Automação (Metas de Produção)

O projeto adere a um rigoroso padrão de qualidade, imposto por automação no pipeline de CI/CD:

*   **Spec-as-Tests:** Testes de aceitação são derivados diretamente das especificações funcionais. Um conjunto de requisitos críticos **deve passar 100%** para que o deploy seja autorizado.
*   **CI/CD Gates:** O pipeline de integração contínua possui gates de qualidade automáticos, incluindo:
    *   **Cobertura de Testes:** Mínimo de 85%.
    *   **Testes de Performance:** Verificação de latência (P95 < 1200ms) e taxa de erro (< 2%) com k6.
    *   **Análise de Segurança:** Verificação de vulnerabilidades estáticas e de dependências.
*   **AutoFix:** Capacidade de utilizar IA para diagnosticar e propor correções para testes que falham, acelerando o ciclo de desenvolvimento.

---

## 🚀 Execução do Frontend

### No AI Studio
1. Clique no botão "Run" ou "Executar".
2. Uma nova aba será aberta com a aplicação em funcionamento.

### Localmente
1. **Clone o repositório.**
2. **Configure as Variáveis de Ambiente:** Crie um arquivo `.env.local` na raiz e adicione `VITE_API_KEY=SUA_API_KEY_AQUI`.
3. **Inicie o Servidor de Desenvolvimento (ex: com Vite):**
   ```bash
   # Instale as dependências (se houver um package.json)
   npm install
   # Inicie o servidor
   npm run dev
   ```
4. Acesse a URL fornecida (geralmente `http://localhost:5173`).

---

## 📁 Estrutura de Pastas (Frontend)

```
/
├── src/
│   ├── agents/            # Lógica de negócios de cada agente IA
│   ├── components/        # Componentes React reutilizáveis
│   ├── hooks/             # Hooks React customizados (ex: useAgentOrchestrator)
│   ├── services/          # Serviços (chamadas à API Gemini, logger)
│   ├── utils/             # Funções utilitárias (parsers, exportação, regras)
│   ├── App.tsx            # Componente principal da aplicação
│   └── types.ts           # Definições de tipos TypeScript
├── index.html             # Arquivo HTML principal
└── README.md              # Este arquivo
```

## Backend FastAPI

O backend FastAPI reside no diretório `backend/`. Consulte `docs/architecture/overview.md` para visão geral, `docs/guides/agent_development.md` para orientar o desenvolvimento de agentes e `docs/api/reference.md` para detalhes das rotas REST.

---

## Connectivity Validator

O artefato `docs/nexus_connectivity_validator_manifest.json` descreve o **Nexus Connectivity Validator**, responsável por diagnosticar, validar e sugerir correções para a comunicação fim a fim entre serviços críticos.

### Como executar

```bash
python validator.py --mode=dry_run --environment=dev
# modos disponíveis: dry_run (somente diagnóstico) e safe_apply (inclui plano de remediação)
# use --format=json para saída estruturada e --output ./relatorio.json para salvar o relatório
```

O comando gera relatórios em `artifacts/reports/` (JSON e Markdown) e encerra com código de saída `1` quando condições bloqueadoras definidas no manifesto forem detectadas.

### Integração CI/CD

Um workflow dedicado (`.github/workflows/connectivity_validator.yml`) executa o modo `dry_run` e publica os artefatos. Em caso de falha, o job `auto_remediate` dispara automaticamente o modo `safe_apply`, anexando o plano de correções e sugerindo pull requests com base no patch plan do manifesto.

---

## Runtime Performance Evaluator

O manifesto `docs/runtime_evaluator_manifest.json` descreve o **Runtime Performance Evaluator**, focado em diagnosticar latência, completude de dados e estratégias de otimização.

### Como executar

```bash
python performance_evaluator.py --mode=dry_run --environment=stage
# use --format=json para saída estruturada e --output ./performance-report.json para salvar o resultado
```

Os relatórios são gerados em `artifacts/performance/` e `artifacts/logs/`. Em modo `safe_apply`, o avaliador inclui sugestões de auto tuning conforme o manifesto.

### Integração CI/CD

O workflow `.github/workflows/performance_validator.yml` executa o modo `dry_run` a cada 12 horas. Em caso de falha, o job dependente reexecuta em `safe_apply`, anexando os relatórios de otimização.
