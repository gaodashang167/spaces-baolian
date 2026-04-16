#!/bin/sh
#
# sync.sh — 备份/还原 OpenClaw 数据到 GitHub
# 同时保留旧的 rclone huggingface 模式
#
# 用法:
#   ./sync.sh backup          — 用 rclone 备份到 HF
#   ./sync.sh restore         — 用 rclone 从 HF 还原
#   ./sync.sh git-backup      — 用 git 备份到 GitHub
#   ./sync.sh git-restore     — 从 GitHub 恢复
#

# ---- GitHub 备份配置 ----
GITHUB_REPO="https://github.com/gaodashang167/openclaw-backup.git"
GITHUB_TOKEN_FILE="/root/.backup-secrets/github-token"
BACKUP_DIR="/tmp/openclaw-gitbackup"
# 备份 workspace、session 和配置文件（排除 exec-approvals.json）
BACKUP_FILES="/root/.openclaw/workspace/ /root/.openclaw/sessions/ /root/.openclaw/agents/main/sessions/ /root/.openclaw/openclaw.json /root/.openclaw/credentials/ /root/.openclaw/identity/ /root/.openclaw/devices/"

# ---- Rclone 配置（旧模式） ----
OPENCLAW_PATHS="
/root/.openclaw/sessions/
/root/.openclaw/workspace/
/root/.openclaw/agents/main/sessions/
/root/.openclaw/openclaw.json
"

# ---- 工具函数: 复制目录但排除 .git ----
copy_dir_no_git() {
  _s="$1"; _d="$2"
  mkdir -p "$_d"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude='.git' --delete "$_s/" "$_d/"
  else
    tar cf - -C "$_s" --exclude='.git' . 2>/dev/null | tar xf - -C "$_d" --no-same-owner 2>/dev/null
  fi
}

# ---- 工具函数: 敏感信息过滤 ----
sanitize_tokens() {
  _file="$1"
  if [ -f "$_file" ]; then
    sed -i 's/ghp_[A-Za-z0-9]\{20,\}/[FILTERED_GITHUB_TOKEN]/g' "$_file"
  fi
}

sanitize_dir_tokens() {
  _dir="$1"
  if [ -d "$_dir" ]; then
    find "$_dir" -type f 2>/dev/null | while read -r _f; do
      sed -i 's/ghp_[A-Za-z0-9_]\{20,\}/[FILTERED_GITHUB_TOKEN]/g' "$_f" 2>/dev/null
    done
  fi
}

# ============================================================
#  GitHub 备份
# ============================================================
git_backup() {
    echo "=== 开始 GitHub 备份 ==="

    if [ ! -f "$GITHUB_TOKEN_FILE" ]; then
        echo "❌ 没有找到 GitHub Token 文件: $GITHUB_TOKEN_FILE"
        exit 1
    fi

    TOKEN=$(cat "$GITHUB_TOKEN_FILE")
    REPO_URL="https://gaodashang167:${TOKEN}@github.com/gaodashang167/openclaw-backup.git"

    rm -rf "$BACKUP_DIR"

    cd /tmp
    git clone --depth 1 "$REPO_URL" "$BACKUP_DIR" 2>&1 || {
        echo ">>> 仓库为空，初始化"
        rm -rf "$BACKUP_DIR"
        git init "$BACKUP_DIR"
        cd "$BACKUP_DIR"
        git checkout -b main
        git config user.email "openclaw@local"
        git config user.name "openclaw"
    }

    cd "$BACKUP_DIR"
    git config user.email "openclaw@local"
    git config user.name "openclaw"

    for src in $BACKUP_FILES; do
        if [ -d "$src" ]; then
            dest="$BACKUP_DIR/src${src}"
            mkdir -p "$dest"
            copy_dir_no_git "$src" "$dest"
            echo "📁 同步目录: $src"
        elif [ -f "$src" ]; then
            dest="$BACKUP_DIR/src/$(dirname "$src")"
            mkdir -p "$dest"
            cp -f "$src" "$dest/"
            echo "📄 同步文件: $src"
        else
            echo "⚠️ 路径不存在: $src"
        fi
    done

    # 过滤敏感信息
    echo "🔒 过滤敏感信息..."
    sanitize_dir_tokens "$BACKUP_DIR/src/root"

    # 添加 .gitignore 排除 token 文件和 exec-approvals.json
    cat > "$BACKUP_DIR/.gitignore" << 'GITIGNORE'
.backup-secrets/
src/root/.openclaw/exec-approvals.json
GITIGNORE

    git add -A
    if git diff --cached --quiet; then
        echo "✅ 无变更，跳过提交"
        return 0
    fi

    TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")
    git commit -m "backup: $TIMESTAMP"
    git push "$REPO_URL" HEAD:main 2>/dev/null
    echo "✅ GitHub 备份完成: $TIMESTAMP"
}

# ============================================================
#  GitHub 还原
# ============================================================
git_restore() {
    echo "=== 开始从 GitHub 还原 ==="

    if [ ! -f "$GITHUB_TOKEN_FILE" ]; then
        echo "❌ 没有找到 GitHub Token 文件: $GITHUB_TOKEN_FILE"
        exit 1
    fi

    TOKEN=$(cat "$GITHUB_TOKEN_FILE")
    REPO_URL="https://gaodashang167:${TOKEN}@github.com/gaodashang167/openclaw-backup.git"

    rm -rf "/tmp/openclaw-gitrestore"
    git clone --depth 1 "$REPO_URL" "/tmp/openclaw-gitrestore"

    for src in $BACKUP_FILES; do
        # 跳过 exec-approvals.json
        case "$src" in
            *exec-approvals.json) echo "⏭️  跳过还原: $src"; continue ;;
        esac
        dest="/tmp/openclaw-gitrestore/src${src}"
        if [ -d "$dest" ]; then
            mkdir -p "$src"
            copy_dir_no_git "$dest" "$src"
            echo "📁 还原目录: $src"
        elif [ -f "$dest" ]; then
            mkdir -p "$(dirname "$src")"
            cp -f "$dest" "$src"
            echo "📄 还原文件: $src"
        else
            echo "⚠️ 备份中没有: $src"
        fi
    done

    rm -rf "/tmp/openclaw-gitrestore"
    echo "✅ GitHub 还原完成"
}

# ============================================================
#  Rclone 旧模式（保持兼容）
# ============================================================
rclone_backup() {
    echo "=== 开始 rclone 备份 ==="
    for path in $OPENCLAW_PATHS; do
        if [ -d "$path" ]; then
            echo "📁 备份目录: $path"
            rclone mkdir "$REMOTE_FOLDER/$path" 2>/dev/null || true
            rclone sync --checksum --progress --create-empty-src-dirs "$path" "$REMOTE_FOLDER/$path"
        elif [ -f "$path" ]; then
            echo "📄 备份文件: $path"
            rclone mkdir "$REMOTE_FOLDER$(dirname "$path")/" 2>/dev/null || true
            rclone copy --checksum --progress "$path" "$REMOTE_FOLDER$(dirname "$path")/"
        fi
    done
    echo "=== rclone 备份完成 ==="
}

rclone_restore() {
    echo "=== 开始 rclone 还原 ==="
    for path in $OPENCLAW_PATHS; do
        # 跳过 exec-approvals.json
        case "$path" in
            *exec-approvals.json) echo "⏭️  跳过还原: $path"; continue ;;
        esac
        if [ -d "$path" ] || [ "${path%/}" != "$path" ]; then
            mkdir -p "$path"
            rclone sync --checksum --progress --create-empty-src-dirs "$REMOTE_FOLDER/$path" "$path"
        else
            mkdir -p "$(dirname "$path")"
            rclone copy --checksum --progress "$REMOTE_FOLDER$(dirname "$path")/$(basename "$path")" "$(dirname "$path")/"
        fi
    done
    echo "=== rclone 还原完成 ==="
}

case "$1" in
    backup)        rclone_backup ;;
    restore)       rclone_restore ;;
    git-backup)    git_backup ;;
    git-restore)   git_restore ;;
    *)             echo "Usage: $0 {backup|restore|git-backup|git-restore}"; exit 1 ;;
esac
