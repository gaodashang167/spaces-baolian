#!/bin/bash

set -Eeuo pipefail

APP_DIR="/app"
OPENCLAW_DIR="/root/.openclaw"
OPENCLAW_JSON="${OPENCLAW_DIR}/openclaw.json"
OLLAMA_LOG="/tmp/ollama.log"
MEMORY_INDEX_LOG="/tmp/memory-index.log"
GIT_BACKUP_LOG="/tmp/git-backup.log"

log() {
  echo ">>> $*"
}

warn() {
  echo ">>> WARN: $*" >&2
}

err() {
  echo ">>> ERROR: $*" >&2
}

cleanup_resolv() {
  if ! grep -q '^nameserver 8\.8\.8\.8$' /etc/resolv.conf 2>/dev/null; then
    echo "nameserver 8.8.8.8" >> /etc/resolv.conf || true
  fi
  if ! grep -q '^nameserver 8\.8\.4\.4$' /etc/resolv.conf 2>/dev/null; then
    echo "nameserver 8.8.4.4" >> /etc/resolv.conf || true
  fi
}

retry() {
  local attempts="$1"
  shift
  local n=1
  until "$@"; do
    if [ "$n" -ge "$attempts" ]; then
      return 1
    fi
    warn "命令失败，第 ${n}/${attempts} 次，重试中：$*"
    n=$((n + 1))
    sleep 3
  done
}

ensure_dirs() {
  mkdir -p \
    "${OPENCLAW_DIR}/agents/main/sessions" \
    "${OPENCLAW_DIR}/credentials" \
    "${OPENCLAW_DIR}/sessions" \
    "${OPENCLAW_DIR}/memory" \
    "${OPENCLAW_DIR}/workspace" \
    "${OPENCLAW_DIR}/identity" \
    "${OPENCLAW_DIR}/devices" \
    /root/.backup-secrets \
    /root/.config/rclone
}

install_system_packages() {
  log "Fix DNS..."
  cleanup_resolv
  log "DNS fixed."

  log "Installing base packages..."
  export DEBIAN_FRONTEND=noninteractive
  retry 3 apt-get update
  retry 3 apt-get install -y --no-install-recommends \
    zstd curl ca-certificates git nginx jq procps iproute2 python3
}

install_ollama() {
  log "Ensuring Ollama prerequisites..."

  if command -v ollama >/dev/null 2>&1; then
    log "Ollama already installed: $(command -v ollama)"
    return 0
  fi

  log "Installing Ollama..."
  local tmp_script="/tmp/ollama-install.sh"

  if retry 5 curl -fL --retry 5 --retry-delay 3 --connect-timeout 20 \
      https://ollama.com/install.sh -o "$tmp_script"; then
    chmod +x "$tmp_script"
    if bash "$tmp_script"; then
      log "Ollama install OK"
      return 0
    fi
  fi

  warn "Ollama install script failed. 将继续流程，但 embedding / memory 可能不可用。"
  return 1
}

start_ollama() {
  if ! command -v ollama >/dev/null 2>&1; then
    warn "未检测到 ollama，跳过启动"
    return 1
  fi

  log "Starting Ollama service..."
  pkill -x ollama >/dev/null 2>&1 || true
  nohup ollama serve >"${OLLAMA_LOG}" 2>&1 &

  for i in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      log "Ollama API ready (${i}s)"
      return 0
    fi
    sleep 1
  done

  warn "Ollama API did not become ready within 60s"
  tail -n 50 "${OLLAMA_LOG}" 2>/dev/null || true
  return 1
}

ensure_embedding_model() {
  if ! command -v ollama >/dev/null 2>&1; then
    warn "ollama 不存在，跳过 embedding model 拉取"
    return 1
  fi

  if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    warn "Ollama API 未就绪，跳过 embedding model 拉取"
    return 1
  fi

  if curl -fsS http://127.0.0.1:11434/api/tags | grep -q '"nomic-embed-text"'; then
    log "Ollama embedding model already present: nomic-embed-text"
    return 0
  fi

  log "Pulling Ollama embedding model: nomic-embed-text"
  if ! retry 3 ollama pull nomic-embed-text; then
    warn "拉取 nomic-embed-text 失败，memory embedding 可能不可用"
    return 1
  fi
}

install_chromium() {
  export PLAYWRIGHT_BROWSERS_PATH=/root/.openclaw/browsers
  local chromium_path
  chromium_path=$(find /root/.openclaw/browsers -name "chrome" -type f 2>/dev/null | head -1 || true)

  if [ -n "${chromium_path:-}" ]; then
    log "Chromium found: ${chromium_path}"
    return 0
  fi

  log "Installing Chromium..."
  local openclaw_nm
  openclaw_nm="$(npm root -g 2>/dev/null)/openclaw/node_modules/playwright-core/cli.js"

  if [ -f "$openclaw_nm" ]; then
    if timeout 180 node "$openclaw_nm" install chromium; then
      log "Chromium OK"
    else
      warn "Chromium install failed"
    fi
  else
    warn "未找到 playwright cli: $openclaw_nm"
  fi
}

generate_openclaw_json() {
  log "Generating openclaw.json..."

  echo ">>> DEBUG: OPENAI_API_BASE=${OPENAI_API_BASE:-}"
  echo ">>> DEBUG: MODEL=${MODEL:-}"
  echo ">>> DEBUG: OPENAI_API_KEY=$([ -n "${OPENAI_API_KEY:-}" ] && echo '(set)' || echo '(EMPTY)')"
  echo ">>> DEBUG: IMAGE_MODEL=${IMAGE_MODEL:-}"
  echo ">>> DEBUG: OPENCLAW_GATEWAY_PASSWORD=$([ -n "${OPENCLAW_GATEWAY_PASSWORD:-}" ] && echo '(set)' || echo '(EMPTY)')"

  CLEAN_BASE="$(echo "${OPENAI_API_BASE:-}" \
    | sed 's|/chat/completions||g' \
    | sed 's|/v1/$|/v1|g' \
    | sed 's|/v1$|/v1|g' \
    | sed 's|/v1/|/v1|g' \
    | sed 's|/$||g')"

  export CLEAN_BASE
  export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
  export MODEL="${MODEL:-}"
  export IMAGE_MODEL="${IMAGE_MODEL:-}"
  export OPENCLAW_GATEWAY_PASSWORD="${OPENCLAW_GATEWAY_PASSWORD:-}"
  export TG_BOT_TOKEN="${TG_BOT_TOKEN:-}"
  export TG_API_ROOT="${TG_API_ROOT:-}"

  echo ">>> DEBUG: CLEAN_BASE=${CLEAN_BASE}"

  python3 <<'PYEOF'
import json, os, sys

clean_base   = os.environ.get("CLEAN_BASE", "")
api_key      = os.environ.get("OPENAI_API_KEY", "")
model        = os.environ.get("MODEL", "")
image_model  = os.environ.get("IMAGE_MODEL", "") or model
gw_password  = os.environ.get("OPENCLAW_GATEWAY_PASSWORD", "")
tg_bot_token = os.environ.get("TG_BOT_TOKEN", "")

errors = []
if not clean_base:
    errors.append("OPENAI_API_BASE is empty")
if not api_key:
    errors.append("OPENAI_API_KEY is empty")
if not model:
    errors.append("MODEL is empty")
if not gw_password:
    errors.append("OPENCLAW_GATEWAY_PASSWORD is empty")

if errors:
    print(">>> ERROR: Missing required env vars:")
    for e in errors:
        print(f"    - {e}")
    sys.exit(1)

models = []
if image_model == model:
    models.append({
        "id": model,
        "name": model,
        "contextWindow": 128000,
        "input": ["text", "image"]
    })
else:
    models.append({
        "id": model,
        "name": model,
        "contextWindow": 128000
    })
    models.append({
        "id": image_model,
        "name": image_model,
        "contextWindow": 128000,
        "input": ["text", "image"]
    })

cfg = {
    "models": {
        "providers": {
            "openai": {
                "baseUrl": clean_base,
                "apiKey": api_key,
                "api": "openai-completions",
                "models": models
            },
            "ollama": {
                "baseUrl": "http://127.0.0.1:11434",
                "api": "ollama",
                "models": []
            }
        }
    },
    "agents": {
        "defaults": {
            "model": {"primary": f"openai/{model}"},
            "imageModel": f"openai/{image_model}",
            "memorySearch": {
                "provider": "ollama",
                "model": "nomic-embed-text",
                "fallback": "none"
            }
        }
    },
    "commands": {"restart": True, "bash": True},
    "tools": {
        "exec": {"ask": "off", "security": "full"},
        "elevated": {
            "enabled": True,
            "allowFrom": {
                "webchat": ["*"]
            }
        }
    },
    "gateway": {
        "mode": "local",
        "bind": "loopback",
        "port": 7861,
        "trustedProxies": ["127.0.0.1", "::1"],
        "auth": {"mode": "token", "token": gw_password},
        "controlUi": {
            "enabled": True,
            "allowInsecureAuth": True,
            "allowedOrigins": ["*"],
            "dangerouslyDisableDeviceAuth": True,
            "dangerouslyAllowHostHeaderOriginFallback": True
        }
    }
}

if tg_bot_token:
    tg_cfg = {
        "enabled": True,
        "botToken": tg_bot_token,
        "dmPolicy": "pairing",
        "groups": {"*": {"requireMention": True}},
        "webhookUrl": "https://wocaca-webopenclaw.hf.space/telegram/webhook",
        "webhookSecret": gw_password,
        "webhookPath": "/telegram/webhook",
        "webhookHost": "0.0.0.0",
        "webhookPort": 8787
    }
    cfg["channels"] = {"telegram": tg_cfg}

out = json.dumps(cfg, indent=2, ensure_ascii=False)
with open("/root/.openclaw/openclaw.json", "w", encoding="utf-8") as f:
    f.write(out)

print(">>> openclaw.json generated OK")
print(f">>> baseUrl={clean_base!r}, model={model!r}, image_model={image_model!r}")
PYEOF
}

write_nginx_conf() {
  log "Writing nginx config..."

  cat > /etc/nginx/nginx.conf <<'NGINXEOF'
worker_processes 1;

events {
    worker_connections 1024;
}

http {
    upstream codeServer {
        server 0.0.0.0:7862;
    }

    map $http_upgrade $connection_upgrade {
        default keep-alive;
        websocket upgrade;
    }

    server {
        listen 7860;
        server_name _;

        location / {
            proxy_pass http://127.0.0.1:7861/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Prefix /openclaw/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header X-Forwarded-Host $host;
            proxy_connect_timeout 5s;
            proxy_next_upstream error timeout http_502 http_503;
            proxy_next_upstream_tries 3;
            proxy_next_upstream_timeout 15s;
        }

        location /coder/ {
            proxy_pass http://codeServer/;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header Host $http_host;
            proxy_set_header X-NginX-Proxy true;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header X-Real-IP $remote_addr;
            proxy_buffering off;
            proxy_redirect default;
            proxy_connect_timeout 1800;
            proxy_send_timeout 1800;
            proxy_read_timeout 1800;
        }

        location /telegram/webhook {
            proxy_pass http://127.0.0.1:8787;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
NGINXEOF
}

restore_from_github() {
  if [ -f "/root/.backup-secrets/github-token" ]; then
    GITHUB_TOKEN="$(cat "/root/.backup-secrets/github-token")"
  elif [ -n "${GITHUB_TOKEN:-}" ]; then
    echo -n "$GITHUB_TOKEN" > /root/.backup-secrets/github-token
    chmod 600 /root/.backup-secrets/github-token
  fi

  if [ -z "${GITHUB_TOKEN:-}" ]; then
    log "未配置 GitHub 备份，跳过恢复"
    return 0
  fi

  local repo_url="https://gaodashang167:${GITHUB_TOKEN}@github.com/gaodashang167/openclaw-backup.git"

  log "检查 GitHub 备份仓库..."
  local remote_head
  remote_head="$(git ls-remote --heads "$repo_url" main 2>/dev/null || true)"

  if [ -z "$remote_head" ]; then
    log "GitHub 仓库无备份记录，跳过恢复"
    return 0
  fi

  log "GitHub 仓库有备份，开始恢复（跳过 openclaw.json）..."
  rm -rf /tmp/openclaw-gitrestore

  if ! git clone --depth 1 "$repo_url" /tmp/openclaw-gitrestore 2>&1; then
    warn "GitHub clone 失败，跳过恢复"
    return 1
  fi

  for src in \
    /root/.openclaw/workspace/ \
    /root/.openclaw/sessions/ \
    /root/.openclaw/agents/main/sessions/ \
    /root/.openclaw/credentials/ \
    /root/.openclaw/identity/ \
    /root/.openclaw/devices/ \
    /root/.openclaw/memory/; do

    dest="/tmp/openclaw-gitrestore/src${src}"
    if [ -d "$dest" ]; then
      mkdir -p "$src"
      tar cf - -C "$dest" --exclude='.git' . 2>/dev/null | tar xf - -C "$src" --no-same-owner 2>/dev/null || \
      cp -rf "${dest}/" "${src}/"
      echo "  📁 恢复: $src"
    fi
  done

  echo "  ⏭️  跳过恢复: /root/.openclaw/openclaw.json（使用环境变量生成的版本）"
  rm -rf /tmp/openclaw-gitrestore
  log "GitHub 恢复完成"
}

restore_from_rclone() {
  mkdir -p ~/.config/rclone

  if [ -n "${RCLONE_CONF:-}" ]; then
    echo "$RCLONE_CONF" > ~/.config/rclone/rclone.conf
    chmod 600 ~/.config/rclone/rclone.conf
    log "Rclone 配置已写入"
  else
    log "没有检测到 Rclone 配置信息"
    return 0
  fi

  if [ -z "${REMOTE_FOLDER:-}" ]; then
    warn "REMOTE_FOLDER 未设置，跳过 rclone 恢复"
    return 0
  fi

  log "同步备份目录..."
  rclone mkdir "$REMOTE_FOLDER" || true

  local output=""
  local exit_code=0
  output="$(rclone ls "$REMOTE_FOLDER" 2>&1)" || exit_code=$?

  if [ "$exit_code" -eq 0 ]; then
    if [ -z "$output" ]; then
      log "初次安装，远程目录为空"
    else
      log "远程文件夹不为空，开始还原"
      (cd "$APP_DIR" && ./sync.sh restore)
      log "恢复完成"
    fi
  elif echo "$output" | grep -qi "directory not found"; then
    warn "Rclone 远程目录不存在"
  else
    warn "Rclone 错误：$output"
  fi
}

run_openclaw_doctor() {
  if command -v openclaw >/dev/null 2>&1; then
    log "Running openclaw doctor --fix"
    openclaw doctor --fix || warn "openclaw doctor --fix 执行失败"
  else
    warn "未找到 openclaw 命令，跳过 doctor"
  fi
}

start_periodic_backup() {
  if [ ! -f "${APP_DIR}/sync.sh" ]; then
    warn "未找到 ${APP_DIR}/sync.sh，跳过定时备份"
    return 0
  fi

  (
    while true; do
      sleep 3600
      log "Running scheduled GitHub backup..."
      cd "${APP_DIR}" && ./sync.sh git-backup >> "${GIT_BACKUP_LOG}" 2>&1 || true
    done
  ) &
}

start_openclaw_gateway() {
  log "Starting openclaw gateway with pm2..."
  pm2 delete openclaw >/dev/null 2>&1 || true
  pm2 start "openclaw gateway run --port 7861" --name openclaw

  log "等待 openclaw gateway 在 7861 端口就绪..."
  for i in $(seq 1 60); do
    if ss -tln 2>/dev/null | grep -q ':7861'; then
      log "openclaw gateway 端口已监听（${i}s）"
      return 0
    fi
    sleep 1
  done

  warn "openclaw gateway 60s 内未就绪，打印 pm2 日志："
  pm2 logs openclaw --lines 50 --nostream || true
  return 1
}

ensure_memory_index() {
  log "检查 memory 索引状态..."

  if ! command -v openclaw >/dev/null 2>&1; then
    warn "未找到 openclaw 命令，跳过 memory 索引检查"
    return 0
  fi

  local status_json
  status_json="$(openclaw memory status --json 2>/dev/null || true)"

  if [ -z "${status_json}" ]; then
    warn "无法读取 memory status，尝试强制重建"
    timeout 600 openclaw memory index --force >> "${MEMORY_INDEX_LOG}" 2>&1 || \
      warn "memory 强制重建失败，请查看 ${MEMORY_INDEX_LOG}"
    return 0
  fi

  export STATUS_JSON="$status_json"
  local need_reindex
  need_reindex="$(
    python3 <<'PY'
import json, os, sys

raw = os.environ.get("STATUS_JSON", "").strip()
if not raw:
    print("yes")
    sys.exit(0)

try:
    data = json.loads(raw)
except Exception:
    print("yes")
    sys.exit(0)

def normalize(obj):
    if isinstance(obj, dict):
        return obj
    if isinstance(obj, list):
        for item in obj:
            if isinstance(item, dict):
                keys = set(item.keys())
                if {"dirty", "indexedFiles", "totalFiles", "chunkCount"} & keys:
                    return item
        if obj and isinstance(obj[0], dict):
            return obj[0]
    return {}

d = normalize(data)

dirty = bool(d.get("dirty"))
indexed = d.get("indexedFiles")
total = d.get("totalFiles")
chunks = d.get("chunkCount")

need = (
    dirty or
    indexed in (None, 0) or
    chunks in (None, 0) or
    (total not in (None, 0) and indexed != total)
)

print("yes" if need else "no")
PY
  )"

  if [ "$need_reindex" = "yes" ]; then
    log "Memory 索引缺失或脏，开始强制重建..."
    timeout 600 openclaw memory index --force >> "${MEMORY_INDEX_LOG}" 2>&1 || \
      warn "memory 强制重建失败，请查看 ${MEMORY_INDEX_LOG}"
  else
    log "Memory 索引已就绪，跳过重建"
  fi
}

start_nginx() {
  log "Testing nginx config..."
  nginx -t

  log "Starting nginx..."
  nginx -g 'daemon off;' &
}

start_code_server() {
  if ! command -v code-server >/dev/null 2>&1; then
    warn "未找到 code-server，跳过启动"
    return 0
  fi

  log "启动 code-server 服务..."
  export PASSWORD="${OPENCLAW_GATEWAY_PASSWORD:-}"
  pm2 delete code-server >/dev/null 2>&1 || true
  pm2 start "code-server --bind-addr 0.0.0.0:7862 --port 7862" --name code-server
}

save_pm2() {
  pm2 startup || true
  pm2 save || true
}

main() {
  ensure_dirs
  install_system_packages

  install_ollama || true
  start_ollama || true
  ensure_embedding_model || true

  install_chromium || true
  generate_openclaw_json
  write_nginx_conf

  restore_from_github || true
  restore_from_rclone || true

  run_openclaw_doctor || true
  start_periodic_backup

  start_openclaw_gateway || true
  ensure_memory_index || true

  start_nginx
  start_code_server
  save_pm2

  log "All services started."
  tail -f /dev/null
}

main "$@"
