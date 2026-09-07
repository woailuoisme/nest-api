/**
 * Vitest 全局 setup
 *
 * 在测试运行前统一配置环境变量与全局行为。
 * 各 vitest config 通过 setupFiles 引用此文件。
 */

// 强制测试环境标识（补充 vitest config 中的 env 设置）
process.env.APP_ENV = 'testing';
