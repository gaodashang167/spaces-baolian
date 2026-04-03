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
GITHUB_REPO="https://github.com/laohu169/openclaw-backup.git"
GITHUB_TOKEN_FILE="/root/.backup-secrets/github-token"
BACKUP_DIR="/tmp/openclaw-gitbackup"
BACKUP_FILES="
/root/.openclaw/workspace/
/root/.openclaw/sessions/
/root/.openclaw/agents/main/sessions/
/root/.openclaw/openclaw.json
"

# ---- Rclone 配置（旧模式） ----
OPENCLAW_PATHS="
/root/.openclaw/sessions/
/root/.openclaw/workspace/
/root/.openclaw/agents/main/sessions/
/root/.openclaw/openclaw.json
"

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
    REPO_URL="https://laohu169:${TOKEN}@github.com/laohu169/openclaw-backup.git"

    # 准备干净的工作目录
    rm -rf "$BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"

    # clone 最新备份
    if [ -d /tmp/openclaw-gitbackup/.git ]; then
        cd "$BACKUP_DIR"
        git pull "$REPO_URL" main 2>/dev/null || {
            cd /tmp
            rm -rf "$BACKUP_DIR"
            git clone --depth 1 "$REPO_URL" "$BACKUP_DIR"
            cd "$BACKUP_DIR"
        }
    else
        cd /tmp
        git clone --depth 1 "$REPO_URL" "$BACKUP_DIR"
        cd "$BACKUP_DIR"
    fi

    git config user.email "openclaw@local"
    git config user.name "openclaw"

    # 同步记忆文件到备份目录
    for src in $BACKUP_FILES; do
        if [ -d "$src" ]; then
            dest="$BACKUP_DIR/src/$(echo $src)"
            mkdir -p "$dest"
            rsync -a --delete "$src" "$dest/" 2>/dev/null || cp -r "$src" "$dest"
            echo "📁 同步目录: $src"
        elif [ -f "$src" ]; then
            dest="$BACKUP_DIR/src/$(dirname $src)"
            mkdir -p "$dest"
            cp -f "$src" "$dest/"
            echo "📄 同步文件: $src"
        else
            echo "⚠️ 路径不存在: $src"
        fi
    done

    # 提交变更
    cd "$BACKUP_DIR"
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
    REPO_URL="https://laohu169:${TOKEN}@github.com/laohu169/openclaw-backup.git"

    # Clone 备份仓库
    rm -rf "/tmp/openclaw-gitrestore"
    git clone --depth 1 "$REPO_URL" "/tmp/openclaw-gitrestore"

    # 把文件还原到原地
    for src in $BACKUP_FILES; do
        dest="/tmp/openclaw-gitrestore/src/$(echo $src)"
        if [ -d "$dest" ]; then
            mkdir -p "$src"
            rsync -a "$dest/" "$src/" 2>/dev/null || cp -r "$dest" "$src"
            echo "📁 还原目录: $src"
        elif [ -f "$dest" ]; then
            mkdir -p "$(dirname "$src")"
            cp -f "$dest" "$src"
            echo "📄 还原文件: $src"
        else
            echo "⚠️ 备份中没有: $src"
        fi
    done

    # 清理
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
            rclone sync --checksum --progress --create-empty-src-dirs \
                "$path" "$REMOTE_FOLDER/$path"
            echo "✅ 完成: $path"
        elif [ -f "$path" ]; then
            echo "📄 备份文件: $path"
            parent_dir=$(dirname "$path")
            rclone mkdir "$REMOTE_FOLDER$parent_dir/" 2>/dev/null || true
            rclone copy --checksum --progress \
                "$path" "$REMOTE_FOLDER$parent_dir/"
            echo "✅ 完成: $path"
        else
            echo "⚠️ 路径不存在: $path"
        fi
    done

    echo "=== rclone 备份完成 ==="
}

rclone_restore() {
    echo "=== 开始 rclone 还原 ==="

    for path in $OPENCLAW_PATHS; do
        if [ -d "$path" ] || [[ "$path" == */ ]]; then
            echo "📁 还原目录: $path"
            mkdir -p "$path"
            rclone sync --checksum --progress --create-empty-src-dirs \
                "$REMOTE_FOLDER/$path" "$path"
            echo "✅ 完成: $path"
        else
            echo "📄 还原文件: $path"
            target_dir=$(dirname "$path")
            mkdir -p "$target_dir"
            parent_dir=$(dirname "$path")
            filename=$(basename "$path")
            rclone copy --checksum --progress \
                "$REMOTE_FOLDER$parent_dir/$filename" "$target_dir/"
            echo "✅ 完成: $path"
        fi
    done

    echo "=== rclone 还原完成 ==="
}

# ============================================================
#  入口
# ============================================================
case "$1" in
    backup)        rclone_backup ;;
    restore)       rclone_restore ;;
    git-backup)    git_backup ;;
    git-restore)   git_restore ;;
    *)
        echo "Usage: $0 {backup|restore|git-backup|git-restore}"
        exit 1
        ;;
esac
