import { logger } from './logger';
import { measureExecution, telemetry, type IntegrationScope } from './telemetry';

interface CircuitState {
  openUntil: number;
  failureCount: number;
  consecutiveRetries: number;
}

interface ResilienceOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
  correlationId?: string;
  attributes?: Record<string, any>;
}

const states: Record<string, CircuitState> = {};

function getState(scope: IntegrationScope, name: string): CircuitState {
  const key = `${scope}:${name}`;
  if (!states[key]) {
    states[key] = { openUntil: 0, failureCount: 0, consecutiveRetries: 0 };
  }
  return states[key];
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWithResilience<T>(
  scope: IntegrationScope,
  name: string,
  operation: () => Promise<T>,
  options: ResilienceOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 400,
    failureThreshold = 5,
    cooldownMs = 30000,
    correlationId,
    attributes,
  } = options;

  const state = getState(scope, name);
  const now = Date.now();

  if (state.openUntil > now) {
    const message = `Circuito aberto para ${scope}.${name} até ${new Date(state.openUntil).toISOString()}`;
    logger.log('Resilience', 'WARN', message, { scope, name }, { correlationId, scope: 'backend' });
    throw new Error(message);
  }

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await measureExecution(
        scope,
        `${name}.attempt.${attempt}`,
        operation,
        {
          correlationId,
          attributes: { ...attributes, attempt },
        }
      );

      telemetry.recordThroughput(scope, name, 1, { ...attributes, attempt });
      state.failureCount = 0;
      state.consecutiveRetries = 0;

      if (attempt > 1) {
        logger.log(
          'Resilience',
          'INFO',
          `Operação ${name} recuperou após ${attempt - 1} retries`,
          { scope, attempt },
          { correlationId, scope: 'backend' }
        );
      }

      return result;
    } catch (error) {
      lastError = error;
      telemetry.recordError(scope, name, { attempt, error: (error as Error).message });
      telemetry.recordRetry(scope, name, { attempt });
      state.failureCount += 1;
      state.consecutiveRetries += 1;

      logger.log(
        'Resilience',
        'WARN',
        `Erro na tentativa ${attempt} para ${name}: ${(error as Error).message}`,
        { scope, attempt },
        { correlationId, scope: 'backend' }
      );

      if (state.failureCount >= failureThreshold) {
        state.openUntil = Date.now() + cooldownMs;
        logger.log(
          'Resilience',
          'ERROR',
          `Circuito aberto para ${name} por ${cooldownMs}ms após ${state.failureCount} falhas consecutivas.`,
          { scope, failureThreshold, cooldownMs },
          { correlationId, scope: 'backend' }
        );
        break;
      }

      if (attempt < maxAttempts) {
        const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
        await delay(delayMs);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Operação ${name} falhou após ${maxAttempts} tentativas.`);
}
