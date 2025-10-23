import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function readJsonIfExists(filePath) {
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function assertCoverage(summary) {
  if (!summary?.total) {
    throw new Error('Cobertura não encontrada. Execute "npm test" antes de publicar o relatório.');
  }
  const { branches, functions, lines, statements } = summary.total;
  const gates = [
    { name: 'branches', value: branches?.pct ?? 0 },
    { name: 'functions', value: functions?.pct ?? 0 },
    { name: 'lines', value: lines?.pct ?? 0 },
    { name: 'statements', value: statements?.pct ?? 0 },
  ];
  const failing = gates.filter(({ value }) => value < 90);
  if (failing.length > 0) {
    const details = failing.map(({ name, value }) => `${name}: ${value.toFixed(2)}%`).join(', ');
    throw new Error(`Cobertura insuficiente: ${details}`);
  }
  return gates;
}

function assertPerformance(summary) {
  if (!summary) {
    throw new Error('Relatório de performance do k6 não encontrado. Execute "npm run load" antes de publicar.');
  }
  const httpMetrics = summary.metrics || {};
  const durationMetric = httpMetrics.http_req_duration || {};
  const failureMetric = httpMetrics.http_req_failed || {};
  const avg = typeof durationMetric.avg === 'number' ? durationMetric.avg : undefined;
  const p95 = typeof durationMetric['p(95)'] === 'number' ? durationMetric['p(95)'] : undefined;
  const errorRate = typeof failureMetric.rate === 'number' ? failureMetric.rate : undefined;
  const breaches = [];
  if (typeof avg === 'number' && avg > 600) {
    breaches.push(`http_req_duration avg: ${avg.toFixed(2)}ms`);
  }
  if (typeof p95 === 'number' && p95 > 1200) {
    breaches.push(`http_req_duration p95: ${p95.toFixed(2)}ms`);
  }
  if (typeof errorRate === 'number' && errorRate > 0.01) {
    breaches.push(`http_req_failed rate: ${(errorRate * 100).toFixed(2)}%`);
  }
  if (breaches.length > 0) {
    throw new Error(`Performance abaixo do mínimo aceitável: ${breaches.join('; ')}`);
  }
  return {
    avg,
    p95,
    errorRate,
  };
}

async function publishReport() {
  const repoRoot = process.cwd();
  const coveragePath = path.join(repoRoot, 'coverage', 'coverage-summary.json');
  const performancePrimaryPath = path.join(repoRoot, 'reports', 'performance', 'k6-summary.json');
  const performanceFallbackPath = path.join(repoRoot, 'reports', 'k6-summary.json');

  const coverageSummary = await readJsonIfExists(coveragePath);
  const performanceSummary =
    (await readJsonIfExists(performancePrimaryPath)) || (await readJsonIfExists(performanceFallbackPath));

  const coverageGates = assertCoverage(coverageSummary);
  const performanceGates = assertPerformance(performanceSummary);

  const payload = {
    timestamp: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY || 'local-dev',
    commitSha: process.env.GITHUB_SHA || 'local-dev',
    coverage: Object.fromEntries(coverageGates.map(({ name, value }) => [name, value])),
    performance: performanceGates,
  };

  const backendUrl = process.env.AUDIT_BACKEND_URL;
  if (backendUrl) {
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Falha ao enviar métricas para o backend de auditoria: ${response.status} ${response.statusText}`);
    }
  } else {
    console.warn('AUDIT_BACKEND_URL não configurada. Relatório gerado apenas localmente.');
  }

  console.log('Relatório de qualidade publicado com sucesso:', JSON.stringify(payload, null, 2));
}

publishReport().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
