# Nexus QuantumI2A2: Análise Fiscal com IA

**Nexus QuantumI2A2** é uma solução completa para análise fiscal assistida por IA. O projeto agora é composto por uma SPA em React/TypeScript e por um backend em FastAPI que centraliza autenticação, chamadas a LLM/OCR e o armazenamento seguro de segredos e trilhas de auditoria.

---

## ✨ Funcionalidades Principais

* **Pipeline multiagente:** processamento determinístico e heurístico de documentos fiscais com agentes de OCR/NLP, auditoria, classificação, inteligência e contabilidade.
* **Upload flexível:** suporte a `XML`, `CSV`, `XLSX`, `PDF`, imagens (`PNG`, `JPG`) e `.ZIP` contendo múltiplos arquivos.
* **Assistente inteligente:** chat contextualizado com os dados auditados, geração de insights e gráficos sob demanda e busca em linguagem natural.
* **Persistência segura:** chaves e dados sensíveis protegidos com AES-256 (KMS interno) e registros append-only em `audit_log.jsonl` assinados digitalmente e enviados para bucket S3/MinIO.
* **Sanitização centralizada:** CPF/CNPJ mascarados exclusivamente no backend antes de qualquer dado ser entregue ao frontend.

---

## 🏗️ Arquitetura

### Frontend (React + Vite)

* SPA em **React 19 + TypeScript**, estilizada com TailwindCSS.
* Orquestra a experiência do usuário (`useAgentOrchestrator`) e consome apenas endpoints autenticados expostos pelo backend.
* Tokens OAuth2 PKCE + refresh são obtidos e renovados automaticamente (`services/authService.ts`).
* Integra-se ao backend através do `services/apiClient.ts` para LLM, OCR, sanitização de dados e chat.

### Backend (FastAPI)

* **Autenticação OAuth2 PKCE** com refresh tokens criptografados e JWT de 30 minutos para o frontend.
* **LLM/OCR**: endpoints autenticados que intermediam chamadas ao Gemini e Tesseract (via `pytesseract`).
* **KMS + Cofre de Segredos**: armazenamento das chaves (ex.: Gemini) cifrado com AES-256-GCM (`SecretVault`).
* **Sanitização e Criptografia**: CPF/CNPJ mascarados antes de persistir ou devolver ao cliente; dados sensíveis gravados via `SensitiveDataStore`.
* **Auditoria Imutável**: `audit_log.jsonl` assinado com Ed25519 e enviado para bucket S3/MinIO quando configurado.

---

## ⚙️ Configuração

### Variáveis de Ambiente do Backend

Crie um arquivo `.env` na raiz do projeto (mesmo nível de `backend/`) com, no mínimo:

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
# Requer Tesseract OCR instalado no sistema (ex.: sudo apt install tesseract-ocr)
uvicorn app.main:app --reload
```

### Variáveis de Ambiente do Frontend

No diretório raiz crie `.env.local` com:

```env
VITE_BACKEND_URL=http://localhost:8000
VITE_AUTH_CLIENT_ID=nexus-spa
VITE_AUTH_USERNAME=admin
VITE_AUTH_PASSWORD=admin123
```

Em seguida instale as dependências do frontend e inicie o Vite:

```bash
npm install
npm run dev
```

O frontend estará disponível em `http://localhost:5173` e utilizará o backend para todas as operações sensíveis.

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
├── services/                     # Clientes para backend, logger, auth
├── utils/                        # Import pipeline, parsing, exports
├── App.tsx                       # Componente principal
├── index.html
├── package.json
└── README.md
```

---

## ✅ Boas Práticas Inclusas

* **OAuth2 PKCE com refresh tokens** e renovação automática no frontend.
* **Segurança de dados**: AES-256-GCM para cofres, mascaramento de PII no backend, upload OCR intermediado.
* **Auditabilidade**: trilha append-only assinada, com suporte a upload S3/MinIO.
* **Modularidade**: serviços reutilizáveis no frontend e backend claramente separados.

---

## 🧪 Testes & Build

* Frontend: `npm run build`
* Backend: recomenda-se `uvicorn app.main:app --reload` + ferramentas como `pytest`/`mypy` (não incluídos) conforme necessário.

---

## 📄 Licença

Distribuído sob a licença MIT. Consulte `LICENSE` para detalhes.
