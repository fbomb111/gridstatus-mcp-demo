#!/bin/bash
# Auto-update wrapper for GridStatus MCP server.
# Claude Desktop runs this on connect — pulls latest, rebuilds, starts.

cd "$(dirname "$0")"
git pull --ff-only >/dev/null 2>&1 || echo "WARN: git pull failed, using local code" >&2
npm ci --silent >/dev/null 2>&1
npm run build --silent >/dev/null 2>&1 || { echo "ERROR: build failed" >&2; exit 1; }
exec node dist/index.js
