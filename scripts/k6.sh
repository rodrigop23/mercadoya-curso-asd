#!/usr/bin/env bash
set -euo pipefail
if command -v k6 >/dev/null && [[ "$(k6 version)" == 'k6 v2.3.0 '* ]]; then
  exec k6 "$@"
fi
version=2.3.0
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=macos-arm64; extension=zip ;;
  Darwin-x86_64) platform=macos-amd64; extension=zip ;;
  Linux-aarch64) platform=linux-arm64; extension=tar.gz ;;
  Linux-x86_64) platform=linux-amd64; extension=tar.gz ;;
  *) echo 'Install k6 v2.3.0 for this platform.' >&2; exit 1 ;;
esac
directory="${XDG_CACHE_HOME:-$HOME/.cache}/mercadoya/k6/$version"
binary="$directory/k6-v$version-$platform/k6"
if [[ ! -x "$binary" ]]; then
  mkdir -p "$directory"
  temporary=$(mktemp -d)
  trap 'rm -rf "$temporary"' EXIT
  artifact="k6-v$version-$platform.$extension"
  origin="https://github.com/grafana/k6/releases/download/v$version"
  curl -fsSL --retry 2 "$origin/$artifact" -o "$temporary/$artifact"
  curl -fsSL --retry 2 "$origin/k6-v$version-checksums.txt" -o "$temporary/checksums.txt"
  python3 - "$temporary" "$artifact" <<'PY'
import hashlib
import pathlib
import sys
directory = pathlib.Path(sys.argv[1])
artifact = sys.argv[2]
expected = next(line.split()[0] for line in (directory / 'checksums.txt').read_text().splitlines()
                if line.split()[-1] == artifact)
actual = hashlib.sha256((directory / artifact).read_bytes()).hexdigest()
if actual != expected:
    raise SystemExit('k6 checksum mismatch')
PY
  if [[ "$extension" == zip ]]; then
    unzip -q "$temporary/$artifact" -d "$directory"
  else
    tar -xzf "$temporary/$artifact" -C "$directory"
  fi
  rm -rf "$temporary"
  trap - EXIT
fi
exec "$binary" "$@"
