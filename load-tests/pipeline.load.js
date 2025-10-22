import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:4173';

export const options = {
  vus: Number(__ENV.K6_VUS || 10),
  duration: __ENV.K6_DURATION || '30s',
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function pipelineSmoke() {
  const response = http.get(BASE_URL);
  check(response, {
    'status is 200': (res) => res.status === 200,
    'html contains app root': (res) => res.body && res.body.includes('Nexus QuantumI2A2'),
  });
  sleep(1);
}
