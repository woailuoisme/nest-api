---
trigger: always_on
description: MCP 工具选型、调用契约与沙盒验证纪律
---

# MCP 工具规范

## 1. 选型

| 工具                         | 用途                                        | 不适用                         |
| :--------------------------- | :------------------------------------------ | :----------------------------- |
| `codegraph`                  | 本地代码拓扑、调用链、改动影响面            | 纯文本匹配、未索引文件         |
| `context7`                   | 第三方库 / 框架官方文档与 API 签名          | 本项目私有代码、语言内置语法   |
| `tavily`                     | 时效性信息：新版 Bug、Breaking Changes、CVE | 成熟 API 用法（用 `context7`） |
| `ast-grep`                   | AST 检索、签名提取、规则验证与批量重构      | 纯文本搜索                     |
| `playwright` / `browser-use` | 真实浏览器验证、页面交互与截图              | 读文档或源码即可回答时         |

`sequential-thinking`、`genui` 按需使用，不作为默认路径。

## 2. 调用契约

- **先读 schema**：调用任何 MCP 工具前，先读 `mcps/<server>/tools/<tool>.json`，不猜参数名与类型。
- **codegraph**：显式传 `projectPath`；返回值视同已读，不得再用 Read 重复读同一段代码。
- **context7**：`resolve-library-id` → `query-docs`；query 聚焦具体 API（如 `"validation pipe options"`），同一主题不重复查询。
- **tavily**：`tavily_search` 取实时信息，`tavily_extract` 取指定页面正文；深度研判用 `search_depth: "advanced"`。
- **ast-grep**：MCP 内只做 CST 转储、试匹配与规则验证；落盘一律走 CLI `--update-all`（见 `ast-grep.md`）。

## 3. 协同顺序

`context7`（官方用法）→ `tavily`（时效补充）→ `codegraph`（本地落点）→ `ast-grep`（改写）→ `just check`（验证）
