import { telemetryConfig } from '../telemetry/config';
import { logger } from './logger';
import type { IntegrationScope } from './telemetry';

async function postWebhook(url: string, payload: unknown) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    logger.log('Alerting', 'ERROR', 'Falha ao enviar alerta para webhook.', {
      error,
      url,
    });
  }
}

export async function sendAlert(scope: IntegrationScope, breaches: string[]) {
  const message = `Alerta de telemetria (${scope.toUpperCase()}): ${breaches.join('; ')}`;
  const payload = {
    text: message,
    scope,
    breaches,
    timestamp: new Date().toISOString(),
  };

  if (telemetryConfig.alertWebhooks.slack) {
    await postWebhook(telemetryConfig.alertWebhooks.slack, payload);
  }

  if (telemetryConfig.alertWebhooks.discord) {
    await postWebhook(telemetryConfig.alertWebhooks.discord, payload);
  }

  logger.log('Alerting', 'WARN', 'Threshold de telemetria excedido.', {
    scope,
    breaches,
  });
}
