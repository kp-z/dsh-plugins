#!/usr/bin/env bash
# 隔离的 DSH 测试实例 —— 用于 dsh-prompt-notes 的真实环境测试。
#
# 隔离方式：DSH_HOME 指向 /tmp 下的全新目录（默认 /tmp/pn-test-home），其中的 web profile
# 是首次使用时新建的；父进程里的 DSH_PROFILE / DSH_PROFILE_DIR / DSH_WEB_URL 等一律 unset，
# 所以它绝不会读写 ~/.dsh、desktop profile，也不会碰用户正在运行的 DSH（端口默认 48990，用户的是 52559）。
#
# 用法（需要在 DSH 会话里运行，以获得 DSH_NODE_EXECUTABLE / DSH_INSTALL_DIR）：
#   scripts/e2e.sh setup     首次：装 dsh-better-sidebar，并把本插件以本地路径装进测试 profile
#   scripts/e2e.sh start     启动实例（后台），打印带认证令牌的 URL（PN_TEST_CWD=目录 可指定实例工作目录）
#   scripts/e2e.sh url       再打印一次 URL
#   scripts/e2e.sh status    运行状态
#   scripts/e2e.sh stop      停止（只会停自己启动的那个 PID）
#   scripts/e2e.sh clean     停止并删除整个测试 HOME
#   scripts/e2e.sh run <dsh 参数…>   以测试 HOME 直接跑 dsh CLI（如 plugin --profile web …）
#
# 注意：改了 Host 半体（index.js / src/*.js）后要 stop → start 才会重新加载；
#       只改 client.js 则刷新页面即可（本地路径安装是 link，直接读源文件）。
set -euo pipefail

: "${DSH_NODE_EXECUTABLE:?run this inside a DSH session (DSH_NODE_EXECUTABLE is unset)}"
: "${DSH_INSTALL_DIR:?run this inside a DSH session (DSH_INSTALL_DIR is unset)}"

HOME_DIR="${PN_TEST_HOME:-/tmp/pn-test-home}"
PORT="${PN_TEST_PORT:-48990}"
PKG="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$DSH_INSTALL_DIR/lib/bin.js"
PIDFILE="$HOME_DIR/web.pid"
LOGFILE="$HOME_DIR/web.log"

# 防呆：测试 HOME 必须在 /tmp 或 $TMPDIR 之下，且不能是真实的 ~/.dsh。
case "$HOME_DIR" in
  /tmp/*|/private/tmp/*|/var/folders/*) ;;
  *) echo "refusing: PN_TEST_HOME must live under /tmp (got $HOME_DIR)" >&2; exit 2 ;;
esac

dsh() {
  env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_WEB_URL -u DSH_SESSION_ID -u DSH_SHELL \
    DSH_HOME="$HOME_DIR" ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" "$CLI" "$@"
}

is_running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }
# 端口上真正的监听进程（dsh 经 env/子 shell 启动，$! 记到的是包装进程，不是监听者）
listener_pid() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1; }

print_url() {
  # 启动日志里会打印带令牌的 URL；取最后一个 http://127.0.0.1:PORT/... 形式
  grep -Eo "https?://127\.0\.0\.1:${PORT}[^[:space:]\"']*" "$LOGFILE" 2>/dev/null | tail -1
}

cmd="${1:-}"; shift || true
case "$cmd" in
  setup)
    mkdir -p "$HOME_DIR"
    dsh plugin --profile web add dsh-better-sidebar@0.28.0
    dsh plugin --profile web add "$PKG"
    echo "setup done: $HOME_DIR"
    ;;
  start)
    mkdir -p "$HOME_DIR"
    if is_running; then echo "already running (pid $(cat "$PIDFILE"))"; print_url; exit 0; fi
    if [ -n "$(listener_pid)" ]; then echo "port $PORT is already in use by pid $(listener_pid); set PN_TEST_PORT or stop it first" >&2; exit 1; fi
    : > "$LOGFILE"
    # PN_TEST_CWD：实例的工作目录（新会话的默认 cwd）——测工作区作用域时用不同目录各起一次
    # 让实例自成一个会话（setsid）并脱离调用方的标准输入输出：否则调用方（管道 / 后台任务 / 定时任务）
    # 会一直等它，或在自己结束 / 被杀时把实例一并带走。
    # 两个细节（都踩过）：
    #  1. 重定向必须套在整个子 shell 上，并用 exec 让它直接「变成」实例。写成 `cd … && cmd < /dev/null &`
    #     时，被放进后台的是整条 && 链：陪着实例的那个子 shell 仍拿着调用方的管道，`start | sed` 永远收不到 EOF。
    #  2. perl 的 exec 不改变 pid，所以 $! 就是实例本身。
    ( cd "${PN_TEST_CWD:-$HOME_DIR}" && exec env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_WEB_URL -u DSH_SESSION_ID -u DSH_SHELL \
        DSH_HOME="$HOME_DIR" ELECTRON_RUN_AS_NODE=1 \
        perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' "$DSH_NODE_EXECUTABLE" "$CLI" web --no-open --port "$PORT" \
      ) < /dev/null >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 120); do
      url="$(print_url || true)"
      if [ -n "$url" ]; then
        lp="$(listener_pid)"; [ -n "$lp" ] && echo "$lp" > "$PIDFILE"   # 以实际监听者为准
        echo "$url"; exit 0
      fi
      is_running || { echo "instance exited early; log tail:" >&2; tail -20 "$LOGFILE" >&2; exit 1; }
      sleep 1
    done
    echo "timed out waiting for the URL; log tail:" >&2; tail -20 "$LOGFILE" >&2; exit 1
    ;;
  url) print_url ;;
  status)
    if is_running; then echo "running pid=$(cat "$PIDFILE") port=$PORT home=$HOME_DIR"; else echo "stopped"; fi
    ;;
  stop)
    if is_running; then
      pid="$(cat "$PIDFILE")"; kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
      echo "stopped $pid"
    else echo "not running"; fi
    rm -f "$PIDFILE"
    ;;
  clean)
    "$0" stop || true
    rm -rf "$HOME_DIR"
    echo "removed $HOME_DIR"
    ;;
  run) dsh "$@" ;;
  *) sed -n '2,22p' "$0"; exit 2 ;;
esac
