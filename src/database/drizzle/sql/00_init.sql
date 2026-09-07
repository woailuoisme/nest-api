-- =============================================================================
-- NestForge Database Full Initialization Script (PostgreSQL)
-- Aggregates all schema definitions from src/database/drizzle/schema/
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PostgreSQL Extensions
-- -----------------------------------------------------------------------------

-- 空间与地理信息计算 (PostGIS)
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 向量检索与 AI Embedding 存储 (pgvector)
CREATE EXTENSION IF NOT EXISTS "vector";

-- 树形与层级路径数据结构 (ltree)
CREATE EXTENSION IF NOT EXISTS "ltree";

-- -----------------------------------------------------------------------------
-- 2. Trigger Functions
-- -----------------------------------------------------------------------------
-- 自动更新 updated_at 时间戳的通用触发器函数
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 3. Module DDLs
-- -----------------------------------------------------------------------------
\ir 01_auth.sql
\ir 02_admin.sql
\ir 03_idempotency.sql
\ir 04_media.sql
\ir 05_notifications.sql

-- -----------------------------------------------------------------------------
-- 4. Triggers
-- -----------------------------------------------------------------------------
-- 用户主表 updated_at 自动更新触发器
DROP TRIGGER IF EXISTS trigger_users_updated_at ON "users";
CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON "users"
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- 管理员主表 updated_at 自动更新触发器
DROP TRIGGER IF EXISTS trigger_admin_users_updated_at ON "admin_users";
CREATE TRIGGER trigger_admin_users_updated_at
    BEFORE UPDATE ON "admin_users"
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- 幂等键表 updated_at 自动更新触发器
DROP TRIGGER IF EXISTS trigger_idempotency_keys_updated_at ON "idempotency_keys";
CREATE TRIGGER trigger_idempotency_keys_updated_at
    BEFORE UPDATE ON "idempotency_keys"
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- 多态媒体表 updated_at 自动更新触发器
DROP TRIGGER IF EXISTS trigger_media_updated_at ON "media";
CREATE TRIGGER trigger_media_updated_at
    BEFORE UPDATE ON "media"
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- 数据库通知表 updated_at 自动更新触发器
DROP TRIGGER IF EXISTS trigger_notifications_updated_at ON "notifications";
CREATE TRIGGER trigger_notifications_updated_at
    BEFORE UPDATE ON "notifications"
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
