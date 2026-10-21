#!/bin/sh
set -e

# 如果传入首参数为选项标志（如 -v, --help），则前置补全 bun 执行
if [ "${1#-}" != "$1" ]; then
  set -- bun "$@"
fi

case "$1" in
  serve|"")
    # 默认启动 HTTP API 服务（CLI 前门：cli serve）
    exec bun run dist/cli.js serve
    ;;
  worker)
    # 独立异步队列 Worker 消费进程（CLI 前门：cli worker）
    exec bun run dist/cli.js worker
    ;;
  cli)
    # 透传 CLI 子命令（如 cli route:list, cli db:seed）
    shift
    exec bun run dist/cli.js "$@"
    ;;
  *)
    # 透传任意自定义命令（如 sh, bun, 诊断工具等）
    exec "$@"
    ;;
esac
