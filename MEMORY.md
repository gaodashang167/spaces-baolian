# MEMORY.md

## GitHub 仓库重点

- **备份仓库**:`gaodashang167/openclaw-backup`
  - URL: `https://github.com/gaodashang167/openclaw-backup`
  - 用途:OpenClaw 的备份/恢复仓库,用于保存和恢复以下内容:
    - `/root/.openclaw/workspace/`
    - `/root/.openclaw/sessions/`
    - `/root/.openclaw/agents/main/sessions/`
    - `/root/.openclaw/openclaw.json`
  - 定时任务:每小时执行一次 GitHub 备份,推送到 `main` 分支。

- **部署仓库**:`gaodashang167/spaces-baolian`
  - URL: `https://github.com/gaodashang167/spaces-baolian`
  - 关键目录:`OpenClaw/`
  - 用途:部署/启动 OpenClaw 的源仓库,包含如 `start-openclaw.sh`、`sync.sh` 等部署脚本。
  - 关系:
    - `spaces-baolian` 负责部署与启动逻辑
    - `openclaw-backup` 负责备份与恢复数据

## 备注

- 当用户提到"备份仓库",默认指 `gaodashang167/openclaw-backup`。
- 当用户说"推备份"或"闭环",默认含义是:**把当前运行态数据推送到 GitHub 备份仓库 `gaodashang167/openclaw-backup`**。
- 当前手动执行该备份的标准路径与命令是:在 `/app` 下运行 `./sync.sh git-backup`(即 `cd /app && ./sync.sh git-backup`)。
- 当用户提到"部署仓库"或"源仓库",默认指 `gaodashang167/spaces-baolian` 下的 `OpenClaw/`。
- 涉及 `start-openclaw.sh`、`sync.sh`、启动/恢复/备份闭环这类持久化逻辑时，默认目标应是**部署仓库 `gaodashang167/spaces-baolian` 的 `OpenClaw/` 目录**，不能只改运行态 `/app`。
- **GitHub 认证**：`GITHUB_TOKEN` 是 HuggingFace Spaces 平台注入的环境变量，备份仓库和部署仓库共用同一个 token。运行时也可从 `/root/.backup-secrets/github-token` 读取。以后所有 GitHub 操作直接用 token，不要问虎哥要。
- 若用户说“中转”，默认优先推荐 **Caddy 中转**，再按实际场景补具体端口和回源地址；中转机本地监听与公网映射应对齐到同一入口端口。
- 以后遇到 GitHub 仓库相关问题，优先先想到这两个仓库，不要只停留在 memory_search 未命中。
- 在 `oc-1178c16b` 这台机器上，另有一套 **Python3 直启** 的 `openai-cpa`，项目目录为 `/opt/openai-cpa`，实际启动入口是 `wfxl_openai_regst.py`，标准启动命令是：`cd /opt/openai-cpa && nohup ./venv/bin/python wfxl_openai_regst.py > app.log 2>&1 &`。这套不是默认优先走 Docker；若用户问“Python3 部署的 openai-cpa 重启了怎么启动”，默认先想到这一条。
- `wenfxl/openai-cpa` 仓库自带 `Dockerfile` 与 `docker-compose.yml`，官方推荐优先走 Docker 部署；官方镜像是 `wenfxl/wenfxl-codex-manager:latest`，默认 Web 端口 `8000`，默认 Web 密码 `admin`。
- 若用户只能通过哪吒探针终端部署 `openai-cpa`，默认优先用 **官方镜像 + docker compose** 的方式，而不是先从源码 build。标准落地目录可用 `/opt/openai-cpa`，最小 compose 关键项包括：端口 `8000:8000`、`./data:/app/data`、`/var/run/docker.sock:/var/run/docker.sock`、`/usr/bin/docker:/usr/bin/docker`、`host.docker.internal:host-gateway`、`HOST_PROJECT_PATH=/opt/openai-cpa`、`TZ=Asia/Shanghai`。
- `oc-1178c16b` 上的 `cloudflared` 回源依赖 `127.0.0.1:8000`；若 Cloudflare 隧道日志报 `Unable to reach the origin service` 或 `connection refused`，优先判断为本地 Python 服务未监听 8000，而不是先判 CF 隧道本身挂了。

## Cloudflare Snippets 代理 Worker 裁剪思路（通用）
- **运行时能力确认**：Snippets 支持 `WebSocketPair`、`fetcher.connect()`、`export default`、`req.fetcher`。不支持的模块（TURN/SSTP/TlsClient/isIPHostname/tlsToSockAdapter）直接删除。
- **保留核心链路**：relay/matchID UUID 校验 + chainConnect(socks5/http/https) + PROXYIP fallback + mill 数据转发 + thresh 调度。
- **CFG 调优**：`concur=1` 避免 Snippets 子请求配额耗尽；`dproxy` 设兜底代理域名（如 `ProxyIP.CMLiussss.net`）；UUID 必须和客户端一致。
- **裁剪策略**：从完整 59KB 源码出发，精确删除大模块及其引用，不改动协议解析逻辑。比完全重写更可靠。
- **部署方式**：GitHub raw 链接 + commit hash 防缓存。用户配置 v2rayN VLESS-WS 连接。
- **常见故障排查**：
  - "连上了但代理不通" → 首先检查 UUID 是否匹配（matchID 失败直接断连）
  - "worker 通 snippets 不通" → 检查 API 兼容性（fetcher.connect、WebSocketPair 等）
  - 浏览器/curl 测试只命中 fallback 分支，必须用真实客户端测试 WebSocket 隧道
- 若用户只能通过哪吒探针终端部署 `openai-cpa`，默认优先用 **官方镜像 + docker compose** 的方式，而不是先从源码 build。标准落地目录可用 `/opt/openai-cpa`，最小 compose 关键项包括：端口 `8000:8000`、`./data:/app/data`、`/var/run/docker.sock:/var/run/docker.sock`、`/usr/bin/docker:/usr/bin/docker`、`host.docker.internal:host-gateway`、`HOST_PROJECT_PATH=/opt/openai-cpa`、`TZ=Asia/Shanghai`。
- 若用户贴出 Docker Compose 的 `version is obsolete` 警告，判断为新版 compose 对 `version:` 字段的兼容提示，**不影响运行**；后续可直接删除 `version:` 行。
- `oc-1178c16b` 上的 `cloudflared` 回源依赖 `127.0.0.1:8000`；若 Cloudflare 隧道日志报 `Unable to reach the origin service` 或 `connection refused`，优先判断为本地 Python 服务未监听 8000，而不是先判 CF 隧道本身挂了。
