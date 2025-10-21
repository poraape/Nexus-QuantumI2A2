# Referência de API

## Autenticação
- JWT (header `Authorization: Bearer <token>`). Para fins de desenvolvimento, as rotas aceitam tokens simulados.

## Endpoints
### `GET /healthz`
Retorna status simples `{ "status": "ok" }`.

### `POST /upload`
Recebe arquivo via multipart form (`file`). Resposta:
```json
{ "job_id": "uuid" }
```

### `GET /status/{job_id}`
Retorna progresso do job:
```json
{ "status": "processing", "data": {}, "trace_id": "uuid" }
```

### `POST /orchestrate`
Executa pipeline síncrono.
Request body (resumo):
```json
{
  "document_id": "string",
  "filename": "arquivo.xml",
  "content_type": "application/xml",
  "storage_path": "s3://bucket/arquivo.xml",
  "metadata": {}
}
```
Resposta: objeto `InsightReport`.
