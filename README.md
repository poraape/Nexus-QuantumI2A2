# Nexus QuantumI2A2: Análise Fiscal com IA

**Nexus QuantumI2A2** é uma Single Page Application (SPA) de análise fiscal interativa que processa dados de Notas Fiscais Eletrônicas (NFe) e outros documentos, gerando insights acionáveis através de um sistema de IA que simula múltiplos agentes especializados.

Esta aplicação demonstra uma arquitetura robusta para processamento de dados em pipeline no lado do cliente, combinando análise determinística com o poder de modelos de linguagem generativa (LLMs) para fornecer uma análise fiscal completa e um assistente de chat inteligente.

---

## ✨ Funcionalidades Principais

*   **Pipeline Multiagente Avançado:** Uma cadeia de agentes especializados (OCR, Auditor, Classificador, **Agente de Inteligência**, Contador) processa os arquivos em etapas, garantindo modularidade e profundidade na análise.
*   **Upload Flexível de Arquivos:** Suporte para múltiplos formatos, incluindo `XML`, `CSV`, `XLSX`, `PDF`, imagens (`PNG`, `JPG`) e arquivos `.ZIP` contendo múltiplos documentos.
*   **Análise Fiscal Aprofundada por IA:** Geração de um relatório detalhado com:
    *   **Resumo Executivo e Recomendações Estratégicas** gerados por IA.
    *   **Detecção de Anomalias por IA** que vai além de regras fixas.
    *   **Validação Cruzada (Cross-Validation)** entre documentos para encontrar discrepâncias sutis.
*   **Busca Inteligente (Smart Search):** Interaja com seus dados através de perguntas em linguagem natural diretamente no dashboard.
*   **Chat Interativo com IA:** Um assistente de IA, contextualizado com os dados do relatório, permite explorar os resultados e gera visualizações de dados sob demanda.
*   **Dashboards Dinâmicos:** Painéis interativos com KPIs, gráficos e filtros para uma visão aprofundada dos dados fiscais.
*   **Simulação Preditiva:** Ferramenta "what-if" que permite simular cenários fiscais alterando parâmetros como alíquotas.
*   **Apuração Contábil:** Geração automática de lançamentos contábeis (débito/crédito) para operações de compra e venda.
*   **Exportação SPED/EFD:** Geração de um arquivo de texto no layout simplificado do SPED Fiscal.
*   **Exportação de Relatórios:** Exporte a análise completa ou as conversas do chat para formatos como `PDF`, `DOCX`, `HTML` e `Markdown`.

---

## 🏗️ Arquitetura do Sistema Multiagente

A arquitetura do sistema foi refatorada para um modelo **Multiagente Assíncrono** (Padrão Orquestrador-Trabalhador), utilizando a API **Gemini 2.5 Flash** como núcleo de inteligência. Este design garante escalabilidade, resiliência a falhas de API e um processamento de documentos desacoplado e eficiente.

1.  **OrchestratorAgent-01 (Agente Orquestrador):**
    *   **Responsabilidade:** É o agente central que atua como ponto de entrada. Recebe novos documentos (XML de NFe, PDF de CTe) e os direciona para a fila de processamento do agente especializado apropriado, com base no tipo de documento e na tarefa necessária (ex: 'para_extrair', 'para_validar').

2.  **ExtractionAgent-02 (Agente de Extração):**
    *   **Responsabilidade:** Consome da fila 'para_extrair'. Utiliza a API Gemini 2.5 Flash para executar OCR e NLP, extraindo dados estruturados (emitente, destinatário, itens, impostos, CFOP, CST) de documentos. Publica o JSON extraído na fila 'para_validar'.

3.  **ValidationAgent-03 (Agente de Validação):**
    *   **Responsabilidade:** Consome da fila 'para_validar'. Utiliza a API Gemini 2.5 Flash com chamadas de função (function calling) para consultar bancos de dados de regras fiscais e cadastros (clientes, fornecedores). Identifica e sugere correções para inconsistências (cálculo de impostos, códigos fiscais). Publica os dados validados junto com um relatório de auditoria na fila 'para_classificar'.

4.  **ClassificationAgent-04 (Agente de Classificação):**
    *   **Responsabilidade:** Consome da fila 'para_classificar'. Utiliza a API Gemini 2.5 Flash para classificar automaticamente documentos por tipo (compra, venda), centro de custo e aplicar lógicas de customização por ramo de atividade (ex: Agronegócio, Indústria). Publica os dados classificados na fila 'para_automatizar'.

5.  **AutomationAgent-05 (Agente de Automação):**
    *   **Responsabilidade:** Consome da fila 'para_automatizar'. Utiliza a API Gemini 2.5 Flash para gerar os artefatos finais: lançamentos contábeis, cálculo de impostos e insumos para obrigações acessórias (SPED). Formata as saídas para integração direta com sistemas ERP.

6.  **ReportingAgent-06 (Agente de Relatórios):**
    *   **Responsabilidade:** Atua como um "Assistente Consultor Especializado". Utiliza a API Gemini 2.5 Flash (com RAG sobre os dados processados) para gerar relatórios personalizados, análises preditivas e responder a consultas em linguagem natural sobre contabilidade e tributação, alimentando a funcionalidade de Chat e Busca Inteligente da interface.

### Stack Tecnológico de Referência (Backend)

*   **Core Intelligence (LLM):** API Gratuita Gemini 2.5 Flash
*   **Application Framework (Agents):** Python 3.11 (FastAPI, LangGraph)
*   **Task Queuing (Async):** Redis (via Celery)
*   **Data Storage:** PostgreSQL (Regras Fiscais, Cadastros) & S3-compatible (Documentos)

---

## 🚀 Execução

### No AI Studio

1.  A aplicação já está configurada e pronta para ser executada.
2.  Clique no botão "Run" ou "Executar" na interface do AI Studio.
3.  Uma nova aba ou janela do navegador será aberta com a aplicação em funcionamento.

### Localmente (Requer Node.js e npm)

1.  **Clone o repositório:**
    ```bash
    git clone <URL_DO_REPOSITORIO>
    cd <NOME_DO_DIRETORIO>
    ```

2.  **Instale as dependências:**
    A aplicação utiliza `es-module-shims` e um `importmap` para carregar dependências diretamente de um CDN, então não há uma etapa de `npm install` tradicional para as bibliotecas do frontend. No entanto, você precisará de um servidor web local para servir os arquivos.

3.  **Configure as Variáveis de Ambiente:**
    *   Crie um arquivo `.env` na raiz do projeto, copiando o `.env.example`.
    *   Adicione sua chave da API Gemini:
        ```
        API_KEY=SUA_API_KEY_AQUI
        ```

4.  **Inicie o Servidor de Desenvolvimento:**
    A forma mais simples de servir os arquivos estáticos é usando o `Vite`:
    ```bash
    # Instale o Vite
    npm install -g vite

    # Inicie o servidor na raiz do projeto
    vite
    ```
    O Vite irá servir o `index.html` e fornecer um ambiente de desenvolvimento com hot-reload.

5.  Acesse a URL fornecida pelo Vite (geralmente `http://localhost:5173`) no seu navegador.

---

## ⚙️ Configuração

As configurações principais da aplicação podem ser gerenciadas através de variáveis de ambiente. Veja o arquivo `.env.example` para a lista completa.

*   `API_KEY`: **Obrigatório.** Sua chave de API para o Google Gemini.
*   `MAX_UPLOAD_MB`: Limite de tamanho para upload de arquivos.
*   `LOG_LEVEL`: Nível de detalhe dos logs a serem capturados (`INFO`, `WARN`, `ERROR`).
*   `ENABLE_SPED_EXPORT`: Habilita a funcionalidade de exportação SPED/EFD.

---

## 📁 Estrutura de Pastas

```
/
├── public/                # Arquivos públicos (se necessário)
├── src/
│   ├── agents/            # Lógica de negócios de cada agente IA
│   ├── components/        # Componentes React reutilizáveis
│   ├── hooks/             # Hooks React customizados (ex: orquestrador)
│   ├── services/          # Serviços (chamadas de API, logging)
│   ├── utils/             # Funções utilitárias (parsers, exportação)
│   ├── App.tsx            # Componente principal da aplicação
│   ├── index.tsx          # Ponto de entrada do React
│   └── types.ts           # Definições de tipos TypeScript
├── .env.example           # Exemplo de arquivo de configuração
├── index.html             # Arquivo HTML principal
├── LICENSE                # Licença do projeto
├── metadata.json          # Metadados para o AI Studio
└── README.md              # Este arquivo
```