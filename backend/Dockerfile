# ================================
# Dockerfile - Nexus Quantum I2A2 Backend
# Stack: FastAPI + Python 3.11
# ================================

FROM python:3.11-slim

# Definir diretório de trabalho
WORKDIR /app

# Instalar dependências
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código-fonte do app
COPY app ./app

# Configurar variáveis de ambiente
ENV PORT=8080
ENV MODE=production

# Expor porta padrão
EXPOSE 8080

# Comando de execução
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
