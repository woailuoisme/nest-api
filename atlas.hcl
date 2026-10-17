# Atlas 配置：通过 drizzle-kit export 将 Drizzle Schema 作为期望状态比对迁移
# 常用命令：
#   atlas migrate diff --env local <name>
#   atlas migrate apply --env local --url "postgresql://...?search_path=public"
# 既有数据库接管顺序：diff init -> baseline

data "external_schema" "drizzle" {
  program = [
    "bun",
    "x",
    "drizzle-kit",
    "export",
  ]
}

env "local" {
  # 必须使用 PG 18 dev 容器以支持 Schema 原生 uuidv7() 规范化
  dev = "docker://postgres/18/dev?search_path=public"
  src = data.external_schema.drizzle.url

  migration {
    dir = "file://atlas/migrations"
  }

  # 排除 Drizzle 内部迁移流水表，防止 Atlas 生成破坏性 DROP
  exclude = ["drizzle"]
}

