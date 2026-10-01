# =============================================================================
# Atlas 配置：把 Drizzle Schema 当作「期望状态（desired state）」
#
# 官方指南：https://atlasgo.io/guides/orms/drizzle/getting-started
# 期望状态由 `drizzle-kit export` 导出 DDL，Atlas 只负责比对、生成与应用迁移。
#
# 常用命令（真实库连接串用 ?search_path=public，不是项目 DB_URL 里的 ?schema=public）：
#   atlas schema inspect --env local --url "env://src"     # 查看 Drizzle 导出的期望 schema
#   atlas migrate diff  --env local <名称>                  # 生成迁移（替代 drizzle-kit generate）
#   atlas migrate apply --env local --url "<连接串>"         # 应用迁移（替代 drizzle-kit migrate）
#   atlas migrate lint  --env local --latest 1             # 迁移静态检查（破坏性变更等）
#
# ⚠️ 接管既有数据库前必须先 baseline，否则会生成「从零建全部表」的迁移：
#   本仓库已用 drizzle-kit 执行过 6 个迁移（drizzle/migrations/，含 meta/ journal）。
#   若直接 `atlas migrate diff`，Atlas 会拿「空的 atlas/migrations 目录」与期望 schema 比对，
#   产出一份等价于全量建表的迁移；对着已有数据的库 `migrate apply` 会失败甚至误改。
#   正确顺序：
#     atlas migrate diff     --env local init      # 生成与当前 Drizzle schema 等价的初始迁移
#     atlas migrate baseline --env local           # 把它标记为「已应用」而不真正执行
#
# 关于真实库连接串：项目 DB_URL 形如 postgresql://…/nestforge?schema=public，
# 其中 ?schema=public 是 drizzle-kit 私有参数，PostgreSQL 原生驱动会直接报
# `unrecognized configuration parameter "schema"`，Atlas 要求的是 ?search_path=public。
# 切勿把 DB_URL 原样喂给 Atlas。
# =============================================================================

data "external_schema" "drizzle" {
  program = [
    # 项目运行时是 Bun（见 .mise.toml），不使用 npx
    "bun",
    "x",
    "drizzle-kit",
    "export",
  ]
}

env "local" {
  # dev 库必须与目标库同引擎、同版本：目标库是 PostgreSQL 18，
  # 且 schema 使用了 PG 18 原生函数 uuidv7()（media / notifications 表的主键默认值），
  # 该函数在 PG 16 上不存在，会导致期望 schema 在 dev 库中无法被规范化。
  #
  # 无需 postgis / pgvector 自定义镜像：`drizzle-kit export` 产出的期望 schema 只用到
  # 内置类型（text / timestamp / integer / varchar / boolean / jsonb / uuid / bigint），
  # 数据库里那些扩展属于运行期设施，不参与 schema 比对。
  dev = "docker://postgres/18/dev?search_path=public"

  # 平铺 src。注意：官方指南给的 `schema { src = ... }` 嵌套写法在 Atlas v1.3.0 上
  # 会报 `no src attribute defined in env`，勿照搬。
  src = data.external_schema.drizzle.url

  migration {
    dir = "file://atlas/migrations"
  }

  # drizzle-kit 的迁移流水表位于独立的 drizzle schema（非业务 schema）。
  # 显式排除：一旦将来放宽连接 scope，Atlas 会把它判为「多余对象」并生成 DROP，
  # 那会直接毁掉 Drizzle 的迁移历史。
  exclude = ["drizzle"]
}
