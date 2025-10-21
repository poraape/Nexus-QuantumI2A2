# SISA2 - Análise Fiscal com IA

**SISA2 (Sistema Inteligente de Suporte à Análise Fiscal)** é uma Single Page Application (SPA) interativa que processa documentos fiscais, gerando insights acionáveis através de um sistema de IA que simula múltiplos agentes especializados.

Esta aplicação é o **cliente frontend** de uma arquitetura robusta, combinando análise determinística com o poder de modelos de linguagem generativa (LLMs) para fornecer uma análise fiscal completa e um assistente de chat inteligente.

---

## ✨ Funcionalidades Principais

*   **Pipeline Multiagente Avançado:** Uma cadeia de agentes especializados (OCR, Auditor, Classificador, Agente de Inteligência, Contador) processa os arquivos em etapas, garantindo modularidade e profundidade na análise.
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

## 🏗️ Arquitetura de Referência: Backend SISA2

O sistema é projetado em uma arquitetura cliente-servidor, desacoplando a interface do usuário do processamento pesado dos dados.

### Frontend (Esta Aplicação)

A aplicação atual é o cliente frontend, desenvolvido como uma SPA usando **React** e **TypeScript**. Ela é responsável por:
*   Fornecer uma interface de usuário rica e interativa.
*   Simular o pipeline de agentes no lado do cliente para demonstração.
*   Interagir com as APIs do backend para enviar documentos e receber os resultados.
*   Renderizar dashboards, relatórios e o assistente de chat.

### Backend (Blueprint de Reconstrução)

O backend é um sistema multiagente assíncrono, robusto e escalável, projetado para processar grandes volumes de documentos fiscais de forma eficiente e resiliente.

#### Stack Tecnológico
*   **Framework:** Python 3.11+ com FastAPI.
*   **Processamento Assíncrono:** Celery com RabbitMQ como message broker e Redis para cache.
*   **Orquestração de Agentes:** Orquestrador baseado em state machine (LangGraph opcional).
*   **Banco de Dados:** PostgreSQL para metadados, regras e logs de auditoria.
*   **Armazenamento de Arquivos:** S3-compatible (MinIO).
*   **Inteligência Artificial:** Google Gemini API (`gemini-2.5-flash`).
*   **Observabilidade:** Padrão OpenTelemetry (OTLP) para tracing, métricas e logs.

#### Sistema Multiagente

*   **Orquestrador:** Gerencia o fluxo de trabalho (Saga pattern), garantindo a execução resiliente e a compensação de falhas em todo o pipeline.
*   **ExtractorAgent:** Ingestão de dados brutos (XML, PDF, Imagens) via fila `q.documents.to_extract`, usando OCR/parsing para extrair dados estruturados e publicá-los em `q.documents.to_audit`.
*   **AuditorAgent:** Consome de `q.documents.to_audit`, aplica um motor de regras fiscais para validar os dados, calcula um score de risco e publica o resultado em `q.documents.to_classify`.
*   **ClassifierAgent:** Consome de `q.documents.to_classify`, categoriza os documentos por tipo de operação e setor, e publica em `q.documents.to_account`.
*   **AccountantAgent:** Consome de `q.documents.to_account`, automatiza lançamentos contábeis, apura impostos e gera o arquivo SPED, publicando o resultado final em `q.documents.to_analyze`.
*   **IntelligenceAgent:** Consome o resultado final de `q.documents.to_analyze` para gerar insights gerenciais, alimentar o RAG para o chat e responder a simulações, garantindo que toda resposta seja rastreável aos dados originais (No-Hallucination Guard).

---

## ✅ Qualidade e Automação

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

### Localmente (Requer Node.js e Vite)
1. **Clone o repositório.**
2. **Configure as Variáveis de Ambiente:** Crie um arquivo `.env` na raiz e adicione `API_KEY=SUA_API_KEY_AQUI`.
3. **Inicie o Servidor de Desenvolvimento:**
   ```bash
   # Instale o Vite
   npm install -g vite
   # Inicie o servidor
   vite
   ```
4. Acesse a URL fornecida (geralmente `http://localhost:5173`).

---

## 📁 Estrutura de Pastas (Frontend)

```
/
├── src/
│   ├── agents/            # Lógica de negócios de cada agente IA (simulação no cliente)
│   ├── components/        # Componentes React reutilizáveis
│   ├── hooks/             # Hooks React customizados (ex: orquestrador)
│   ├── services/          # Serviços (chamadas de API, logging, Gemini)
│   ├── utils/             # Funções utilitárias (parsers, exportação)
│   ├── App.tsx            # Componente principal da aplicação
│   └── types.ts           # Definições de tipos TypeScript
├── index.html             # Arquivo HTML principal
└── README.md              # Este arquivo
```
