#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
profile=${1:-local}
operation=${2:-run}
[[ "$profile" == local || "$profile" == ci ]] || exit 2
export COMPOSE_PROJECT_NAME=mercadoya-perf
export COMPOSE_FILE=docker-compose.yml:tests/perf/compose.perf.yml
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  export COMPOSE_FILE="$COMPOSE_FILE:tests/perf/compose.ci.yml"
fi
export COMPOSE_PROFILES=agent
export COMPOSE_ENV_FILES=tests/perf/out/stack.env
mkdir -p tests/perf/out

if [[ "$operation" == down ]]; then
  [[ -f "$COMPOSE_ENV_FILES" ]] || exit 0
  docker compose down -v --remove-orphans
  rm -f "$COMPOSE_ENV_FILES"
  exit
fi
if [[ "$operation" != k6 ]]; then
  # El archivo contiene credenciales efímeras de esta stack. Nunca se imprime.
  python3 - <<'PY'
import os
import secrets
names = ['BETTER_AUTH_SECRET', 'CATALOG_INTERNAL_TOKEN', 'MCP_INTERNAL_TOKEN',
         'NOTIFICATIONS_INVOKE_TOKEN', 'AGENT_DB_PASSWORD']
path = 'tests/perf/out/stack.env'
if os.path.exists(path):
    raise SystemExit(0)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as env:
    for name in names:
        env.write(f'{name}={secrets.token_urlsafe(48)}\n')
PY
  # Ignora el .env habitual del desarrollador.
  docker compose up -d --wait --wait-timeout 60 postgres nats
  for service in catalog identity orders; do
    DATABASE_URL=postgresql://mercadoya:mercadoya_local@localhost:15432/mercadoya \
      pnpm --filter "@mercadoya/$service-service" db:migrate
  done
  docker compose exec -T postgres psql -U mercadoya -d mercadoya -v ON_ERROR_STOP=1 \
    < tests/perf/seed.sql
  docker compose up -d --build --wait --wait-timeout 120
  # Kong puede arrancar antes de que Docker registre el nombre del agente.
  docker compose restart kong
  docker compose up -d --wait --wait-timeout 60 kong
fi
docker compose exec -T agent-service python - <<'PY'
import os
assert os.environ['AGENT_MODEL_PROVIDER'] == 'echo'
assert os.environ['AGENT_CLASSIFIER_PROVIDER'] == 'rules'
assert os.environ['LANGSMITH_TRACING'] == 'false'
for name, value in os.environ.items():
    if name.startswith(('OPENAI_', 'CLOUDFLARE_', 'LANGSMITH_', 'LANGCHAIN_')):
        assert not value or value in ('false', 'true'), f'{name} must be empty or boolean'
print('AGENT_MODEL_PROVIDER=echo; AGENT_CLASSIFIER_PROVIDER=rules; OPENAI_API_KEY=empty; LANGSMITH_TRACING=false')
PY
if [[ "$operation" == up ]]; then exit; fi
K6_NO_USAGE_REPORT=true bash scripts/k6.sh run --no-usage-report -e "K6_PROFILE=$profile" tests/perf/gateway.js
