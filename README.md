# Nexus QuantumI2A2: Análise Fiscal com IA

**Nexus QuantumI2A2** é uma solução completa para análise fiscal assistida por IA. O projeto combina uma SPA em React/TypeScript com um backend em FastAPI que centraliza autenticação, chamadas a LLM/OCR, sanitização de dados sensíveis e a trilha imutável de auditoria.

---

## ✨ Funcionalidades Principais

* **Pipeline multiagente híbrido:** importação, OCR/NLP, auditoria determinística, classificação fiscal, validação cruzada e análises gerenciais são orquestradas pelo frontend e contam com serviços especializados expostos pelo backend.
* **Upload flexível:** suporte a `XML`, `CSV`, `XLSX`, `PDF`, imagens (`PNG`, `JPG`) e pacotes `.ZIP` contendo múltiplos arquivos.
* **Assistente inteligente:** chat contextualizado com os dados auditados, geração de insights, gráficos sob demanda e busca em linguagem natural (Smart Search).
* **Persistência segura:** chaves e dados sensíveis protegidos com AES-256 (KMS interno) e registros append-only em `audit_log.jsonl`, assinados digitalmente e enviados para S3/MinIO quando configurado.
* **Sanitização centralizada:** CPF/CNPJ e demais identificadores mascarados no backend antes de os dados chegarem ao navegador.
* **Exportação de relatórios:** geração de resumos estratégicos, dashboards e arquivos SPED/EFD simplificados diretamente da aplicação.

---

## 🧪 Qualidade & Testes

| Comando | Descrição |
| --- | --- |
| `npm test` | Executa a suíte de testes unitários com Jest/Testing Library e gera relatório de cobertura (≥90% para agentes, serviços, orchestrator e dashboard). |
| `npm run e2e` | Sobe o preview do Vite e roda os testes de fumaça com Cypress. |
| `npm run load` | Executa o teste de carga com k6 (parametrizável via `K6_BASE_URL`, `K6_VUS`, `K6_DURATION`) e exporta métricas em `reports/k6-summary.json`. |
| `npm run report:quality` | Consolida cobertura + performance, envia para o backend de auditoria (`AUDIT_BACKEND_URL`) e falha caso algum gate fique abaixo do mínimo. |

> **Importante:** substitua `<owner>` na badge de status do GitHub Actions (se desejar exibi-la) pelo nome da organização ou usuário que hospeda o repositório.

---

## 🏗️ Arquitetura

### Frontend (React + Vite)

* SPA em **React 19 + TypeScript**, estilizada com TailwindCSS.
* Orquestra a experiência do usuário (`useAgentOrchestrator`) consumindo endpoints autenticados do backend.
* Tokens OAuth2 PKCE + refresh são obtidos e renovados automaticamente (`services/authService.ts`).
* Consome serviços dedicados para OCR, sanitização, geração de relatórios e chat via `services/apiClient.ts`.

### Backend (FastAPI)

* **Autenticação OAuth2 PKCE** com refresh tokens criptografados e JWT com expiração curta para o frontend.
* **LLM/OCR**: endpoints autenticados que intermediam chamadas ao Gemini e ao Tesseract (via `pytesseract`).
* **KMS + Cofre de Segredos**: armazenamento de chaves (ex.: Gemini) cifrado com AES-256-GCM (`SecretVault`).
* **Sanitização e Criptografia**: CPF/CNPJ mascarados antes de persistir ou devolver ao cliente; dados sensíveis gravados via `SensitiveDataStore`.
* **Auditoria Imutável**: `audit_log.jsonl` assinado com Ed25519 e enviado para bucket S3/MinIO quando configurado.

---

## 📊 Observabilidade Local & Dashboards

* Execute `python -m app.services.audit.report_generator --schedule nightly --output reports/monitoring` para gerar relatórios consolidados das métricas dos agentes, incluindo ajustes aplicados automaticamente pelo EfficiencyGuard.
* Consulte `docs/guides/observability_dashboards.md` para instruções completas sobre como alimentar dashboards locais e integrar os artefatos gerados aos scripts de revisão.
* Endpoint opcional para download: `GET /api/monitoring/metrics?format=json` (ou `format=csv&download=1` para exportar planilha pronta para análise offline).

---

## ⚙️ Configuração

### Variáveis de Ambiente do Backend

Crie um arquivo `.env` na raiz do backend com, no mínimo:

```env
# Criptografia e tokens
JWT_SECRET_KEY="chave-super-secreta"
KMS_MASTER_KEY="<chave_base64_de_32_bytes>"
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin123

# Credenciais OAuth
OAUTH_CLIENT_IDS=nexus-spa

# Opcional: bucket S3/MinIO
# BUCKET_NAME=auditoria
# BUCKET_ENDPOINT_URL=http://localhost:9000
# BUCKET_ACCESS_KEY=...
# BUCKET_SECRET_KEY=...
```

> Para gerar rapidamente uma chave AES-256 base64 execute `python -c "import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"`.

Instale as dependências do backend e execute o servidor:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Requer Tesseract OCR instalado (ex.: sudo apt install tesseract-ocr)
uvicorn app.main:app --reload
```

### Variáveis de Ambiente do Frontend

Crie `.env.local` no diretório raiz com:

```env
VITE_BACKEND_URL=http://localhost:8000
VITE_AUTH_CLIENT_ID=nexus-spa
VITE_AUTH_USERNAME=admin
VITE_AUTH_PASSWORD=admin123
```

Instale as dependências do frontend e inicie o Vite:

```bash
npm install
npm run dev
```

A SPA ficará disponível em `http://localhost:5173` e utilizará o backend para as operações sensíveis.

---

## 📁 Estrutura de Pastas

```
/
├── backend/
│   ├── app/
│   │   ├── auth.py               # Fluxo OAuth2 PKCE e JWT
│   │   ├── config.py             # Configurações (pydantic)
│   │   ├── main.py               # Aplicação FastAPI e rotas protegidas
│   │   └── services/             # LLM, OCR, KMS, auditoria, masking, storage
│   └── requirements.txt
├── components/                   # Componentes React
├── hooks/                        # Hooks (inclui useAgentOrchestrator)
├── services/                     # Clientes para backend, logger, auth, LLM, OCR
├── utils/                        # Import pipeline, parsing, exports
├── App.tsx                       # Componente principal
├── index.html
├── package.json
└── README.md
```

---

## ✅ Boas Práticas Inclusas

* **OAuth2 PKCE com refresh tokens** e renovação automática no frontend.
* **Segurança de dados**: AES-256-GCM para cofres, mascaramento de PII no backend, uploads OCR intermediados.
* **Auditabilidade**: trilha append-only assinada, com suporte a upload S3/MinIO.
* **Modularidade**: serviços reutilizáveis no frontend e backend claramente separados.

---

## 🧪 Testes & Build

* Frontend: `npm run build`
* Backend: recomenda-se `uvicorn app.main:app --reload` e, conforme necessário, ferramentas como `pytest`/`mypy`.

---

## 📄 Licença

Distribuído sob a licença MIT. Consulte `LICENSE` para detalhes.
