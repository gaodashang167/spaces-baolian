#!/bin/bash

set -e

# 1. 补全目录
mkdir -p /root/.openclaw/agents/main/sessions
mkdir -p /root/.openclaw/credentials
mkdir -p /root/.openclaw/sessions

# ── 2. Fix DNS ────────────────────────────────────────────────
echo "nameserver 8.8.8.8" >> /etc/resolv.conf
echo "nameserver 8.8.4.4" >> /etc/resolv.conf
echo ">>> DNS fixed."

# ── 3. Chromium ───────────────────────────────────────────────
export PLAYWRIGHT_BROWSERS_PATH=/root/.openclaw/browsers
CHROMIUM_PATH=$(find /root/.openclaw/browsers -name "chrome" -type f 2>/dev/null | head -1)

if [ -z "$CHROMIUM_PATH" ]; then
    echo ">>> Installing Chromium..."
    OPENCLAW_NM=$(npm root -g 2>/dev/null)/openclaw/node_modules/playwright-core/cli.js
    if timeout 180 node "$OPENCLAW_NM" install chromium; then
        echo ">>> Chromium OK"
    else
        echo ">>> WARN: Chromium install failed"
    fi
    CHROMIUM_PATH=$(find /root/.openclaw/browsers -name "chrome" -type f 2>/dev/null | head -1)
else
    echo ">>> Chromium found: $CHROMIUM_PATH"
fi

# ── 4. 生成 openclaw.json（始终用环境变量，不从备份恢复）────────
echo ">>> DEBUG: OPENAI_API_BASE=${OPENAI_API_BASE}"
echo ">>> DEBUG: MODEL=${MODEL}"
echo ">>> DEBUG: OPENAI_API_KEY=$([ -n "$OPENAI_API_KEY" ] && echo '(set)' || echo '(EMPTY)')"
echo ">>> DEBUG: IMAGE_MODEL=${IMAGE_MODEL}"
echo ">>> DEBUG: OPENCLAW_GATEWAY_PASSWORD=$([ -n "$OPENCLAW_GATEWAY_PASSWORD" ] && echo '(set)' || echo '(EMPTY)')"

# 处理API地址并export给Python
CLEAN_BASE=$(echo "$OPENAI_API_BASE" | sed "s|/chat/completions||g" | sed "s|/v1/$|/v1|g" | sed "s|/v1$|/v1|g" | sed "s|/v1/|/v1|g" | sed 's|/$||g')
export CLEAN_BASE
export OPENAI_API_KEY
export MODEL
export IMAGE_MODEL
export OPENCLAW_GATEWAY_PASSWORD
export TG_BOT_TOKEN
export TG_API_ROOT

echo ">>> DEBUG: CLEAN_BASE=${CLEAN_BASE}"

python3 <<'PYEOF'
import json, os, sys

clean_base   = os.environ.get("CLEAN_BASE", "")
api_key      = os.environ.get("OPENAI_API_KEY", "")
model        = os.environ.get("MODEL", "")
image_model  = os.environ.get("IMAGE_MODEL", "") or model
gw_password  = os.environ.get("OPENCLAW_GATEWAY_PASSWORD", "")
tg_bot_token = os.environ.get("TG_BOT_TOKEN", "")
tg_api_root  = os.environ.get("TG_API_ROOT", "")

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
                "models": []  # FIX: 新版要求此字段为数组，否则报 Invalid input: expected array
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
        "bind": "lan",
        "port": 7861,
        "trustedProxies": ["0.0.0.0/0"],
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
        # FIX: 移除 apiRoot 字段，新版 openclaw 不再支持该字段（会报 Unrecognized key）
        # 如需自定义 Telegram API 地址，请通过环境变量或其他方式配置
    }
    cfg["channels"] = {"telegram": tg_cfg}

out = json.dumps(cfg, indent=2, ensure_ascii=False)
with open("/root/.openclaw/openclaw.json", "w") as f:
    f.write(out)
print(">>> openclaw.json generated OK")
print(f">>> baseUrl={clean_base!r}, model={model!r}, image_model={image_model!r}")
PYEOF

# 创建nginx配置
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
      'websocket' upgrade;
    }
    
    server {
        listen 7860;
        server_name _;
        
        location / {
            proxy_pass http://127.0.0.1:7861/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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


# 6. 执行恢复
if [ -f "/root/.backup-secrets/github-token" ]; then
  GITHUB_TOKEN=$(cat "/root/.backup-secrets/github-token")
elif [ -n "$GITHUB_TOKEN" ]; then
  mkdir -p /root/.backup-secrets
  echo -n "$GITHUB_TOKEN" > /root/.backup-secrets/github-token
  chmod 600 /root/.backup-secrets/github-token
fi

if [ -n "$GITHUB_TOKEN" ]; then
  GITHUB_REPO_URL="https://gaodashang167:${GITHUB_TOKEN}@github.com/gaodashang167/openclaw-backup.git"
  echo ">>> 检查 GitHub 备份仓库..."
  REMOTE_HEAD=$(git ls-remote --heads "$GITHUB_REPO_URL" main 2>/dev/null)
  if [ -n "$REMOTE_HEAD" ]; then
    echo ">>> GitHub 仓库有备份，开始恢复（跳过 openclaw.json）..."
    rm -rf /tmp/openclaw-gitrestore
    git clone --depth 1 "$GITHUB_REPO_URL" /tmp/openclaw-gitrestore 2>&1 || { echo ">>> GitHub clone 失败，跳过"; }
    if [ -d /tmp/openclaw-gitrestore ]; then
      for src in /root/.openclaw/workspace/ /root/.openclaw/sessions/ /root/.openclaw/agents/main/sessions/ /root/.openclaw/credentials/ /root/.openclaw/identity/; do
        dest="/tmp/openclaw-gitrestore/src${src}"
        if [ -d "$dest" ]; then
          mkdir -p "$src"
          tar cf - -C "$dest" --exclude='.git' . 2>/dev/null | tar xf - -C "$src" --no-same-owner 2>/dev/null || cp -rf "${dest}/" "${src}/"
          echo "  📁 恢复: $src"
        fi
      done
      echo "  ⏭️  跳过恢复: /root/.openclaw/openclaw.json（使用环境变量生成的版本）"
      rm -rf /tmp/openclaw-gitrestore
      echo ">>> GitHub 恢复完成"
    fi
  else
    echo ">>> GitHub 仓库无备份记录，跳过恢复"
  fi
else
  echo ">>> 未配置 GitHub 备份，跳过恢复"
fi

echo "======================写入rclone配置========================"
echo "$RCLONE_CONF" > ~/.config/rclone/rclone.conf

if [ -n "$RCLONE_CONF" ]; then
  echo "##########同步备份############"
  rclone mkdir $REMOTE_FOLDER
  OUTPUT=$(rclone ls "$REMOTE_FOLDER" 2>&1)
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 0 ]; then
    if [ -z "$OUTPUT" ]; then
      echo "初次安装"
    else
        echo "远程文件夹不为空开始还原"
        ./sync.sh restore
        echo "恢复完成."
    fi
  elif [[ "$OUTPUT" == *"directory not found"* ]]; then
    echo "错误：文件夹不存在"
  else
    echo "错误：$OUTPUT"
  fi
else
    echo "没有检测到Rclone配置信息"
fi

# 7. 运行
openclaw doctor --fix

# 启动定时备份
(while true; do
  sleep 3600
  echo ">>> Running scheduled GitHub backup..."
  cd /app && ./sync.sh git-backup >> /tmp/git-backup.log 2>&1
done) &

nginx -t
if [ $? -ne 0 ]; then
  echo "nginx 配置失败"
  cat /var/log/nginx/error.log
  exit 1
fi

# 先启动 openclaw，等端口就绪再启动 nginx
pm2 start "openclaw gateway run --port 7861" --name openclaw

echo ">>> 等待 openclaw gateway 在 7861 端口就绪..."
for i in $(seq 1 60); do
  if ss -tlnp 2>/dev/null | grep -q ':7861'; then
    echo ">>> openclaw gateway 端口已监听（${i}s）"
    break
  fi
  if [ $i -eq 60 ]; then
    echo ">>> WARN: openclaw gateway 60s 内未就绪，打印pm2日志："
    pm2 logs openclaw --lines 30 --nostream || true
  fi
  sleep 1
done

nginx -g 'daemon off;' &

echo "======================启动code-server服务========================"
export PASSWORD=$OPENCLAW_GATEWAY_PASSWORD
pm2 start "code-server --bind-addr 0.0.0.0:7862 --port 7862" --name "code-server"
pm2 startup
pm2 save

tail -f /dev/null
