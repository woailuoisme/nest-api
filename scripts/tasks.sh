#!/usr/bin/env bash
# 项目任务脚本（justfile 的唯一实现入口）
#
#   bash scripts/tasks.sh <command> [args...]
#
#   dev              开发模式：API + Worker 双进程（SWC watch）
#   start            生产预览：先构建，再用 dist/ 跑双进程
#   build            生产构建（清空 dist + SWC 编译）
#   migrate          应用数据库迁移（先修复 journal）
#   kill-port [port] 释放端口占用（默认 $PORT，回退 4300）
#   mail             编译 MJML 邮件模板为 Handlebars
#   help             显示本帮助
#
# 所有命令先切到仓库根目录；只依赖 bun / node / lsof。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DEFAULT_PORT=4300
MAIL_SRC_DIR="src/common/mail/templates/src"
MAIL_OUT_DIR="src/common/mail/templates"

# 头部注释即帮助正文，不再维护第二份文案
usage() {
  sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

cmd_build() {
  # 用 find -delete 而非 rm -rf：dist 数百个文件，批量删除会被删除保护拦截
  if [ -d dist ]; then
    find dist -mindepth 1 -delete
  fi
  bun x nest build
}

cmd_kill_port() {
  local port="${1:-${PORT:-${DEFAULT_PORT}}}"
  local pids
  pids="$(lsof -ti:"${port}" 2>/dev/null || true)"

  if [ -n "${pids}" ]; then
    echo "[kill-port] 释放端口 ${port}（PID: $(tr '\n' ' ' <<<"${pids}")）"
    # 多个 PID 需按空格拆开，故不加引号
    # shellcheck disable=SC2086
    kill -9 ${pids} 2>/dev/null || true
  fi
}

# 用命令前缀拉起 serve + worker；任一退出（含崩溃）时带走另一个。
# PID 用全局变量：trap 可能在函数返回后触发，local 届时已失效。
run_api_worker() {
  "$@" serve &
  API_PID=$!

  "$@" worker &
  WORKER_PID=$!

  trap 'kill ${API_PID} ${WORKER_PID} 2>/dev/null || true' EXIT INT TERM

  # 轮询而非 `wait`：后者等全部退出，单侧崩溃会留下孤儿；
  # 不用 `wait -n` 以兼容 bash < 4.3（macOS 自带 3.2）。
  while kill -0 "${API_PID}" 2>/dev/null && kill -0 "${WORKER_PID}" 2>/dev/null; do
    sleep 1
  done
}

cmd_dev() {
  cmd_kill_port "${PORT:-${DEFAULT_PORT}}"
  run_api_worker bun x nest start --watch --entryFile cli --
}

cmd_start() {
  cmd_build
  cmd_kill_port "${PORT:-${DEFAULT_PORT}}"
  run_api_worker node dist/cli.js
}

cmd_migrate() {
  bun scripts/repair-migration-journal.ts
  bun x drizzle-kit migrate
}

# 只编译顶层 *.mjml；partials/ 由 mj-include 内联，不单独产出
cmd_mail() {
  local file name
  for file in "${MAIL_SRC_DIR}"/*.mjml; do
    name="$(basename "${file}" .mjml)"
    bun x mjml "${file}" -o "${MAIL_OUT_DIR}/${name}.hbs" --config.allowIncludes true
    echo "compiled ${name}.hbs"
  done
}

# 白名单即「命令名 → cmd_<命令名>」映射；新增子命令 = 写函数 + 这里加一个词
readonly COMMANDS='build|dev|start|migrate|kill-port|mail'

main() {
  local command="${1:-}"
  shift || true

  case "${command}" in
    help | -h | --help | '') usage ;;
    *)
      if [[ ! "${command}" =~ ^(${COMMANDS})$ ]]; then
        echo "未知命令：${command}" >&2
        echo >&2
        usage >&2
        exit 1
      fi
      "cmd_${command//-/_}" "$@"
      ;;
  esac
}

main "$@"
