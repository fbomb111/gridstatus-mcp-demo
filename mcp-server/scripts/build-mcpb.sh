#!/bin/bash
# Build the GridStatus .mcpb Desktop Extension
#
# Output: gridstatus.mcpb in the mcp-server directory
#
# Uses mcpb CLI if available, falls back to manual zip.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "Building MCP server..."
npm ci --silent
npm run build --silent

# Remove HTTP-only files from dist (not needed for stdio .mcpb)
rm -f dist/http.js dist/http.js.map
rm -rf dist/auth

# Prune to production dependencies only
npm prune --production --silent 2>/dev/null || true

OUTPUT="gridstatus.mcpb"

# Try mcpb CLI first, fall back to manual zip
if command -v mcpb &>/dev/null; then
  echo "Packaging with mcpb..."
  mcpb pack --output "$OUTPUT"
else
  echo "mcpb CLI not found, packaging manually..."
  STAGING=$(mktemp -d)
  trap 'rm -rf "$STAGING"' EXIT

  # Copy only what the extension needs
  cp manifest.json "$STAGING/"
  cp package.json "$STAGING/"
  cp -r dist "$STAGING/"
  cp -r node_modules "$STAGING/"

  # Create .mcpb (zip archive)
  rm -f "$OUTPUT"
  (cd "$STAGING" && zip -r -q - .) > "$OUTPUT"

  echo "Built: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
fi

# Restore dev dependencies for continued development
npm install --silent 2>/dev/null || true
