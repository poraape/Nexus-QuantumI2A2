# Guia de Desenvolvimento de Agentes

Os agentes residem em `backend/app/agents` e seguem a classe base `Agent`.

## Regras Gerais
- Implementar método `run(input) -> output`.
- Utilizar decorator `@retryable` para retries exponenciais (máx. 3 tentativas).
- Respeitar timeout de 120s por execução.
- Emitir métricas básicas (`latency_ms`, `retries`, `errors`, `throughput`).
- Garantir idempotência através do `document_id`.

## Passo a Passo
1. Herdar de `Agent` e definir atributo `name`.
2. Encapsular lógica em função interna `_execute` e chamar `self._execute_with_metrics`.
3. Retornar modelos Pydantic definidos em `app/schemas`.
4. Registrar agente no orquestrador se participar do pipeline principal.
