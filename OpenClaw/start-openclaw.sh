#!/usr/bin/env bash
set -euo pipefail

# Sync selected workspace files into persist-repo (whitelist).
# Intended to run hourly.

WS="/home/node/.openclaw/workspace"
PR="/home/node/.openclaw/persist-repo"

# Ensure target exists
if [[ ! -d "$PR" ]]; then
  echo "persist-repo not found: $PR" >&2
  exit 1
fi

mkdir -p "$PR/workspace"

# Whitelist files (no templates)
FILES=(
  "MEMORY.md"
  "USER.md"
  "TOOLS.md"
  "HEARTBEAT.md"
  "IDENTITY.md"
  "SOUL.md"
  "AGENTS.md"
)

for f in "${FILES[@]}"; do
  if [[ -f "$WS/$f" ]]; then
    cp -f "$WS/$f" "$PR/workspace/$f"
  fi
done

# Also keep a copy at repo root for convenience (per user rule)
if [[ -f "$WS/MEMORY.md" ]]; then
  cp -f "$WS/MEMORY.md" "$PR/MEMORY.md"
fi

# Keep only a local backup copy reference in persist-repo; do not treat it as an auto-restore source.
mkdir -p "$PR/config"
if [[ -f "/home/node/.openclaw/openclaw.json" ]]; then
  if node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/home/node/.openclaw/openclaw.json", "utf8"));
if (!j?.agents?.defaults?.memorySearch) process.exit(1);
'; then
    cp -f "/home/node/.openclaw/openclaw.json" "$PR/config/openclaw.runtime-reference.json"
  else
    echo "[sync] live config missing agents.defaults.memorySearch; skip runtime-reference overwrite"
  fi
fi
if [[ -f "/home/node/.openclaw/openclaw.json.bak" ]]; then
  cp -f "/home/node/.openclaw/openclaw.json.bak" "$PR/config/openclaw.runtime-reference.json.bak"
fi

# Sync daily notes if present
if [[ -d "$WS/memory" ]]; then
  mkdir -p "$PR/workspace/memory"
  # copy only markdown notes
  find "$WS/memory" -maxdepth 1 -type f -name "*.md" -print0 \
    | xargs -0 -I{} cp -f {} "$PR/workspace/memory/"
fi

echo "sync-workspace-to-persist: OK"
