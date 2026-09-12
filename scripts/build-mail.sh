#!/usr/bin/env bash
# 编译 MJML 邮件模板 → Handlebars 模板（.hbs）
# 仅编译顶层 *.mjml（partials/ 由 mj-include 内联，不单独产出）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src/common/mail/templates/src"
OUT_DIR="$ROOT_DIR/src/common/mail/templates"

for f in "$SRC_DIR"/*.mjml; do
  name="$(basename "$f" .mjml)"
  bun x mjml "$f" -o "$OUT_DIR/$name.hbs" --config.allowIncludes true
  echo "compiled $name.hbs"
done
