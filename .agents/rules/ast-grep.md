---
trigger: always_on
glob: '**/*.{go,ts,tsx,js,jsx,py,rs,sql,json,yaml}'
description: ast-grep 语法级检索与批量重构的强制执行规范
---

# ast-grep 规范

## 1. 何时必须用

签名变更、接口迁移、类型重命名、导包路径调整、同一模式跨文件改写 —— 一律走 `ast-grep`。

**禁止**：逐文件手工轮询改写同一模式；用 `sd` / `sed` / 正则改代码源文件（会破坏 AST、误伤同名标识符）。

## 2. 四步闭环

1. **定位**：`rtk ast-grep outline <path>` 看结构；需要节点类型名时用 MCP `dump_syntax_tree`。
2. **写规则**：单行改写用 `--pattern` + `--rewrite`；关系型规则（`inside` / `has`）必须写 `stopBy: end`。
3. **沙盒验证**：MCP `test_match_code_rule`，或 `echo '<code>' | rtk ast-grep scan --inline-rules '<yaml>' --stdin`；确认命中数与改写结果后才落盘。
4. **应用并验证**：`rtk ast-grep scan --rule <rule.yml> --update-all <dir>` → `just check`（格式化 + lint + 类型 + 测试）。

```yaml
id: migrate-call
language: go
rule:
  pattern: s.q.$METHOD($CTX, $$$ARGS)
  inside: { kind: function_declaration, stopBy: end }
fix: s.repo.$METHOD($CTX, $$$ARGS)
```

## 3. 速查

| 语法 / 参数         | 用途                                | 示例                                                  |
| :------------------ | :---------------------------------- | :---------------------------------------------------- |
| `$VAR`              | 单个 AST 节点（变量、标识符、类型） | `response.OK(c, $DATA)`                               |
| `$$$ARGS`           | 0..n 个节点序列（实参、语句块）     | `r.Post($PATH, $$$HANDLERS)`                          |
| `stopBy: end`       | 关系型匹配深度遍历整个子树          | `inside: { kind: function_declaration, stopBy: end }` |
| `--update-all`      | 批量写入磁盘（非交互）              | `rtk ast-grep scan --rule r.yml --update-all src`     |
| `--stdin`           | 从 stdin 无副作用试跑               | `echo '...' \| rtk ast-grep scan --stdin`             |
| `--debug-query=cst` | 打印模式的语法树（定位 `kind` 名）  | `rtk ast-grep run -p '...' --debug-query=cst`         |
