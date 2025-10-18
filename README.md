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

O núcleo da aplicação é um pipeline orquestrado que simula o trabalho de uma equipe de especialistas fiscais. Cada "agente" é um módulo de software com uma responsabilidade específica.

1.  **Agente OCR & NLP (`importPipeline.ts`):**
    *   **Responsabilidade:** Extrair texto e dados estruturados de diversos formatos de arquivo, usando Tesseract.js para imagens e parsers específicos para cada tipo.
    *   **Entrada:** Arquivos brutos.
    *   **Saída:** `ImportedDoc` com dados normalizados.

2.  **Agente Auditor (`auditorAgent.ts`):**
    *   **Responsabilidade:** Aplicar um conjunto de regras fiscais determinísticas (`rulesEngine.ts`) para identificar inconsistências óbvias em cada documento.
    *   **Entrada:** Documentos com dados estruturados.
    *   **Saída:** `AuditedDocument` com status (`OK`, `ALERTA`, `ERRO`) e lista de inconsistências.

3.  **Agente Classificador (`classifierAgent.ts`):**
    *   **Responsabilidade:** Classificar a natureza de cada operação (Compra, Venda, etc.) com base em heurísticas sobre códigos CFOP e NCM.
    *   **Entrada:** `AuditedDocument`.
    *   **Saída:** `AuditedDocument` enriquecido com dados de classificação.
    
4.  **⚡ Agente de Inteligência (`intelligenceAgent.ts`):**
    *   **Responsabilidade:** Utilizar a API Gemini para realizar análises complexas que regras determinísticas não conseguem capturar.
        1.  **Detecção de Anomalias:** Identifica padrões incomuns nos dados (ex: volatilidade de preços, combinações estranhas de CFOP/NCM).
        2.  **Validação Cruzada:** Compara todos os documentos entre si para encontrar discrepâncias em atributos fiscais e valores.
    *   **Entrada:** Relatório de auditoria e classificação.
    *   **Saída:** `aiDrivenInsights` e `crossValidationResults`.

5.  **Agente Contador (`accountantAgent.ts`):**
    *   **Responsabilidade:**
        1.  Executar agregações determinísticas (somas, contagens).
        2.  Gerar os lançamentos contábeis e o arquivo SPED.
        3.  Utilizar a API Gemini para gerar o resumo executivo, insights acionáveis e **recomendações estratégicas** com base em todos os dados coletados.
    *   **Entrada:** Relatório completo, incluindo os insights do Agente de Inteligência.
    *   **Saída:** O `AuditReport` final.

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