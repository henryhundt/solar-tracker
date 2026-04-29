#!/usr/bin/env bash
set -euo pipefail

# Prefer the locally installed Homebrew Node 20 runtime when available.
if [ -x /opt/homebrew/opt/node@20/bin/node ]; then
  export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 20 LTS first." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ] || [ "$node_major" -ge 25 ]; then
  echo "Use Node 20-24 for local development. Current version: $(node -v)" >&2
  exit 1
fi

exec node "$@"
