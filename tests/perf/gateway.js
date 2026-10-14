import http from 'k6/http';
import { check, fail, sleep } from 'k6';

const profile = __ENV.K6_PROFILE || 'local';
if (!['local', 'ci'].includes(profile)) throw new Error('K6_PROFILE must be local or ci');
const base = (__ENV.BASE_URL || 'http://localhost:18000').replace(/\/$/, '');
const load =
  profile === 'ci'
    ? { executor: 'constant-vus', vus: 5, duration: '30s' }
    : {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '30s', target: 20 },
          { duration: '60s', target: 20 },
          { duration: '30s', target: 0 },
        ],
      };

export const options = {
  scenarios: {
    catalog_search: { ...load, exec: 'catalogSearch', gracefulStop: '5s' },
    agent_chat: { ...load, exec: 'agentChat', gracefulStop: '5s' },
    agent_unauthorized: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 5,
      exec: 'agentUnauthorized',
      maxDuration: '10s',
    },
  },
  thresholds: {
    http_req_failed: [
      { threshold: 'rate<0.01', abortOnFail: profile === 'ci', delayAbortEval: '10s' },
    ],
    'http_req_duration{name:catalog_search}': ['p(95)<30'],
    'http_req_duration{name:agent_chat}': ['p(95)<1550'],
    checks: ['rate>0.99'],
  },
  // No URL, IDs de hilos, cuerpos ni credenciales en el resumen.
  systemTags: ['name', 'method', 'status', 'scenario', 'expected_response'],
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)'],
};

function json(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

export function setup() {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base) && __ENV.K6_ALLOW_REMOTE !== '1') {
    fail('BASE_URL must be loopback; remote requires K6_ALLOW_REMOTE=1');
  }
  const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' };
  // Comprador sintético por ejecución; solo existe en PostgreSQL local.
  const email = `perf-${Date.now()}@example.invalid`;
  const password = `Perf-${Date.now()}-Ab1!`;
  const signup = http.post(
    `${base}/api/auth/sign-up/email`,
    JSON.stringify({ email, password, name: 'Perf fixture' }),
    { headers, tags: { name: 'auth_signup' } },
  );
  if (signup.status !== 200) fail('Identity signup failed');
  const login = http.post(`${base}/api/auth/sign-in/email`, JSON.stringify({ email, password }), {
    headers,
    tags: { name: 'auth_login' },
  });
  if (login.status !== 200) fail(`Identity login failed (${login.status})`);
  const token = http.get(`${base}/api/auth/token`, { tags: { name: 'auth_token' } });
  const jwt = json(token)?.token;
  if (token.status !== 200 || !jwt) fail('Identity JWT issuance failed');
  return { jwt };
}

const terms = [
  'audífonos',
  'laptop',
  'teclado',
  'mouse',
  'monitor',
  'cámara',
  'usb',
  'cable',
  'parlante',
  'funda',
];
export function catalogSearch() {
  const index = (__VU + __ITER) % terms.length;
  const filters =
    index % 3 === 0
      ? '&minPrice=20&maxPrice=1000'
      : index % 3 === 1
        ? '&maxPrice=500'
        : '&minPrice=0';
  const response = http.get(
    `${base}/api/products?q=${encodeURIComponent(terms[index])}${filters}`,
    { tags: { name: 'catalog_search' } },
  );
  check(response, {
    'catalog status 200': (r) => r.status === 200,
    'catalog products array': (r) => Array.isArray(json(r)?.products),
  });
  sleep(0.2);
}

export function agentChat({ jwt }) {
  const params = {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    tags: { name: 'agent_thread' },
  };
  const created = http.post(`${base}/api/agent/threads`, '{}', params);
  const tid = json(created)?.thread_id;
  check(created, { 'agent thread created': (r) => r.status === 200 && !!tid });
  if (!tid) return;
  const response = http.post(
    `${base}/api/agent/threads/${tid}/runs/wait`,
    JSON.stringify({
      assistant_id: 'agent',
      input: { messages: [{ role: 'user', content: 'busco audífonos' }] },
    }),
    { ...params, tags: { name: 'agent_chat' } },
  );
  check(response, {
    'agent status 200': (r) => r.status === 200,
    'agent nonempty echo': (r) =>
      json(r)?.messages?.some(
        (m) =>
          (m.type === 'ai' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.includes('eco:'),
      ),
  });
  http.del(`${base}/api/agent/threads/${tid}`, null, {
    ...params,
    tags: { name: 'agent_cleanup' },
  });
  sleep(0.2);
}

export function agentUnauthorized() {
  const response = http.post(`${base}/api/agent/runs/wait`, '{}', {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'agent_unauthorized' },
    responseCallback: http.expectedStatuses(401),
  });
  check(response, { 'gateway requires JWT': (r) => r.status === 401 });
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const lines = Object.entries(metrics)
    .filter(([, m]) => m.thresholds)
    .map(
      ([name, m]) =>
        `${Object.values(m.thresholds).every((t) => t.ok) ? '✓' : '✗'} ${name} ${JSON.stringify(m.values)}`,
    );
  return {
    'tests/perf/out/summary.json': JSON.stringify({ metrics }, null, 2),
    stdout: `${lines.join('\n')}\n`,
  };
}
