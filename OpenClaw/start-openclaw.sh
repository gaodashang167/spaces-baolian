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

# 4. 处理 API 地址
CLEAN_BASE=$(echo "$OPENAI_API_BASE" | sed "s|/chat/completions||g" | sed "s|/v1/|/v1|g" | sed "s|/v1$|/v1|g")

# 4. 生成配置文件
cat > /root/.openclaw/openclaw.json <<EOF
{
  "models": {
    "providers": {
      "nvidia": {
        "baseUrl": "$CLEAN_BASE",
        "apiKey": "$OPENAI_API_KEY",
        "api": "openai-completions",
        "models": [
          { "id": "$MODEL", "name": "$MODEL", "contextWindow": 128000 }
        ]
      }
    }
  },
  "agents": { "defaults": { "model": { "primary": "nvidia/$MODEL" } } },
  "commands": {
    "restart": true
  },
  "tools": {
      "exec": {
        "ask": "off",
        "security": "full"
      }
    },
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "port": 7861,
    "trustedProxies": ["0.0.0.0/0"],
    "auth": { "mode": "token", "token": "$OPENCLAW_GATEWAY_PASSWORD" },
    "controlUi": {
      "enabled": true,
      "allowInsecureAuth": true,
      "allowedOrigins": ["*"],
      "dangerouslyDisableDeviceAuth": true,
      "dangerouslyAllowHostHeaderOriginFallback": true
    }
  }
EOF

# TG设置 -- 如设置了TG_BOT_TOKEN则追加channels配置
if [ -n "$TG_BOT_TOKEN" ]; then
  sed -i '$ d' /root/.openclaw/openclaw.json
  cat >> /root/.openclaw/openclaw.json <<TGEOF
,
"channels": {
    "telegram": {
      "enabled": true,
      "botToken": "$TG_BOT_TOKEN",
      "dmPolicy": "pairing",
TGEOF
  if [ -n "$TG_API_ROOT" ]; then
    printf '      "apiRoot": "%s",\n' "$TG_API_ROOT" >> /root/.openclaw/openclaw.json
  fi
  cat >> /root/.openclaw/openclaw.json <<TGEOF
      "groups": { "*": { "requireMention": true } },
      "webhookUrl": "https://wocaca-webopenclaw.hf.space/telegram/webhook",
      "webhookSecret": "$OPENCLAW_GATEWAY_PASSWORD",
      "webhookPath": "/telegram/webhook",
      "webhookHost": "0.0.0.0",
      "webhookPort": 8787
    }
  }
}
TGEOF
fi

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
# ── 6a. 从 GitHub 备份仓库恢复 ──────────────────────────────
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
    echo ">>> GitHub 仓库有备份，开始恢复..."
    rm -rf /tmp/openclaw-gitrestore
    git clone --depth 1 "$GITHUB_REPO_URL" /tmp/openclaw-gitrestore 2>/dev/null || { echo ">>> GitHub clone 失败，跳过"; }
    if [ -d /tmp/openclaw-gitrestore ]; then
      for src in /root/.openclaw/workspace/ /root/.openclaw/sessions/ /root/.openclaw/agents/main/sessions/; do
        dest="/tmp/openclaw-gitrestore/src${src}"
        if [ -d "$dest" ]; then
          mkdir -p "$src"
          tar cf - -C "$dest" --exclude='.git' . 2>/dev/null | tar xf - -C "$src" --no-same-owner 2>/dev/null || cp -rf "${dest}/" "${src}/"
          echo "  📁 恢复: $src"
        fi
      done
      # ⚠️ 跳过恢复 openclaw.json —— 它应由启动脚本用环境变量生成，否则覆盖后变量失效
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
  rclone mkdir "$REMOTE_FOLDER"
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
  elif echo "$OUTPUT" | grep -q "directory not found"; then
    echo "错误：文件夹不存在"
  else
    echo "错误：$OUTPUT"
  fi
else
    echo "没有检测到Rclone配置信息"
fi

# 7. 运行
openclaw doctor --fix

# 启动定时备份（每小时一次 GitHub 备份）
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

# 启动 nginx 后台运行
nginx

# 使用 pm2 启动 openclaw
pm2 start "openclaw gateway run --port 7861" --name openclaw

echo "======================启动code-server服务========================"
export PASSWORD="$OPENCLAW_GATEWAY_PASSWORD"
pm2 start "code-server --bind-addr 0.0.0.0:7862 --port 7862" --name "code-server"
pm2 startup
pm2 save

# 保持容器运行
tail -f /dev/null
