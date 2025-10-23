# ======================================================
#  STAGE 1 — FRONTEND (React + Vite)
# ======================================================
FROM node:20-alpine AS frontend_builder

# Definir diretório de trabalho
WORKDIR /frontend

# Copiar arquivos do frontend
COPY src/package*.json ./
RUN npm install

# Copiar todo o código do frontend e buildar
COPY src/ ./
RUN npm run build

# ======================================================
#  STAGE 2 — BACKEND (FastAPI + Python)
# ======================================================
FROM python:3.11-slim AS backend_builder

# Diretório de trabalho
WORKDIR /app

# Instalar dependências do backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código do backend
COPY backend/app ./app

# ======================================================
#  STAGE 3 — FINAL (SERVIDOR UNIFICADO)
# ======================================================
FROM python:3.11-slim

# Diretório final
WORKDIR /app

# Copiar backend do estágio anterior
COPY --from=backend_builder /app /app

# Copiar frontend compilado para a pasta pública
COPY --from=frontend_builder /frontend/dist /app/app/static

# Instalar dependências necessárias para servir o front
RUN pip install --no-cache-dir fastapi uvicorn aiofiles

# Variáveis de ambiente
ENV PORT=8080
ENV MODE=production

# Expor porta padrão
EXPOSE 8080

# Comando de inicialização (serve backend + frontend)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
