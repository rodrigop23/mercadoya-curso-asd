#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
image='aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa'
cache="${TRIVY_CACHE_DIR:-$HOME/.cache/trivy}"
mkdir -p "$cache"
report=$(mktemp)
trap 'rm -f "$report"' EXIT
status=0
docker run --rm -v "$PWD:/repo:ro" -v "$cache:/root/.cache/trivy" -w /repo \
  "$image" fs --config trivy.yaml --format json . > "$report" || status=$?
if [[ ! -s "$report" ]]; then
  echo 'Trivy could not complete the scan.' >&2
  exit 1
fi
python3 scripts/security-report.py "$report"
exit "$status"
