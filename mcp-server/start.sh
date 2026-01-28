#!/bin/bash
# Auto-update wrapper for GridStatus MCP server.
# Claude Desktop runs this on connect — pulls latest, rebuilds, starts.

cd "$(dirname "$0")"
git pull --ff-only 2>/dev/null
npm run build --silent 2>/dev/null
exec node dist/index.js
