# Nexus QuantumI2A2: Análise Fiscal com IA

**Nexus QuantumI2A2** é uma Single Page Application (SPA) de análise fiscal interativa que processa dados de Notas Fiscais Eletrônicas (NFe) e outros documentos, gerando insights acionáveis através de um sistema de IA que simula múltiplos agentes especializados.

Esta aplicação demonstra uma arquitetura robusta para processamento de dados em pipeline no lado do cliente, combinando análise determinística com o poder de modelos de linguagem generativa (LLMs) para fornecer uma análise fiscal completa e um assistente de chat inteligente.

---

## ✨ Funcionalidades Principais

*   **Pipeline Multiagente:** Uma cadeia de agentes especializados (OCR, Auditor, Classificador, Contador) processa os arquivos em etapas, garantindo modularidade e clareza no fluxo de trabalho.
*   **Upload Flexível de Arquivos:** Suporte para múltiplos formatos, incluindo `XML`, `CSV`, `XLSX`, `PDF`, imagens (`PNG`, `JPG`) e arquivos `.ZIP` contendo múltiplos documentos.
*   **Análise Fiscal Abrangente:** Geração de um relatório detalhado com resumo executivo, métricas chave, insights acionáveis e uma análise documento a documento com score de risco.
*   **Chat Interativo com IA:** Um assistente de IA, contextualizado com os dados do relatório, permite explorar os resultados através de perguntas em linguagem natural e gera visualizações de dados sob demanda.
*   **Dashboards Dinâmicos:** Painéis interativos com KPIs, gráficos e filtros para uma visão aprofundada dos dados fiscais.
*   **Simulação Preditiva:** Ferramenta "what-if" que permite simular cenários fiscais alterando parâmetros como alíquotas e regimes tributários para prever impactos.
*   **Apuração Contábil:** Geração automática de lançamentos contábeis (débito/crédito) para operações de compra e venda.
*   **Exportação SPED/EFD:** Geração de um arquivo de texto no layout simplificado do SPED Fiscal (EFD ICMS IPI), pronto para validação.
*   **Segurança e Logging:** Validações de segurança no upload e um sistema de logging estruturado para auditoria e troubleshooting.
*   **Exportação de Relatórios:** Exporte a análise completa ou as conversas do chat para formatos como `PDF`, `DOCX`, `HTML` e `Markdown`.

---

## 🏗️ Arquitetura do Sistema Multiagente

O núcleo da aplicação é um pipeline orquestrado que simula o trabalho de uma equipe de especialistas fiscais. Cada "agente" é um módulo de software com uma responsabilidade específica.

1.  **Agente OCR (`ocrExtractor.ts`):**
    *   **Responsabilidade:** Extrair texto de documentos baseados em imagem (PDFs de imagem, PNG, JPG) usando Tesseract.js.
    *   **Entrada:** Arquivo de imagem/PDF.
    *   **Saída:** `ImportedDoc` com o conteúdo de texto extraído.

2.  **Agente NLP (`nlpAgent.ts`):**
    *   **Responsabilidade:** Realizar extração de entidades fiscais (CNPJ, valores, CFOP) a partir de texto não estruturado usando regras determinísticas (Regex).
    *   **Entrada:** `ImportedDoc` com texto.
    *   **Saída:** `ImportedDoc` com dados estruturados.

3.  **Agente Auditor (`auditorAgent.ts`):**
    *   **Responsabilidade:** Aplicar um conjunto de regras fiscais determinísticas (`rulesEngine.ts`) para identificar inconsistências em cada documento.
    *   **Entrada:** Documentos com dados estruturados.
    *   **Saída:** `AuditedDocument` com status (`OK`, `ALERTA`, `ERRO`), score de risco e lista de inconsistências.

4.  **Agente Classificador (`classifierAgent.ts`):**
    *   **Responsabilidade:** Classificar a natureza de cada operação (Compra, Venda, etc.) e o setor de negócio com base em heurísticas sobre códigos CFOP e NCM.
    *   **Entrada:** `AuditedDocument`.
    *   **Saída:** `AuditedDocument` enriquecido com dados de classificação.

5.  **Agente Contador (`accountantAgent.ts`):**
    *   **Responsabilidade:**
        1.  Executar agregações determinísticas (somas, contagens, impostos) sobre os dados auditados.
        2.  Gerar os lançamentos contábeis de débito e crédito.
        3.  Gerar o arquivo no formato SPED/EFD.
        4.  Utilizar a API Gemini para gerar um resumo executivo, métricas chave e insights acionáveis com base nos dados agregados e em uma amostra dos dados.
    *   **Entrada:** Relatório de auditoria completo.
    *   **Saída:** O `AuditReport` final com a análise da IA, lançamentos contábeis e arquivo SPED.

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
        GEMINI_API_KEY=SUA_API_KEY_AQUI
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

*   `GEMINI_API_KEY`: **Obrigatório.** Sua chave de API para o Google Gemini.
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
