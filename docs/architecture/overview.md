# Visão Arquitetural

Este documento descreve a arquitetura alvo do projeto Nexus-QuantumI2A2. O frontend React/Vite permanece inalterado e consome o backend FastAPI exposto no diretório `backend/`.

## Componentes Principais
- **FastAPI**: expõe rotas REST `/upload`, `/status/{job_id}` e `/orchestrate`.
- **Agentes**: pipeline `Extractor -> Auditor -> Classifier -> Accountant -> Intelligence` implementado em `backend/app/agents`.
- **Orquestrador**: `PipelineOrchestrator` coordena agentes e publica tarefas Celery.
- **Banco de Dados**: PostgreSQL com SQLAlchemy + Alembic (`backend/app/db`).
- **Mensageria**: Celery com Redis padrão (RabbitMQ em produção).
- **Armazenamento**: MinIO/S3 para arquivos de entrada.
- **Observabilidade**: logs estruturados, métricas e traces via OpenTelemetry (a serem conectados).

## Fluxo de Dados
1. Upload chega ao backend e é salvo no storage.
2. Orquestrador cria job e dispara pipeline.
3. Cada agente lê/escreve dados e métricas.
4. Resultado final retorna para o frontend.
