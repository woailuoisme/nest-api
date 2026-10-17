// 注：otel/telemetry 为入口级副作用模块（需经 main/worker 显式先导），刻意不经 barrel 导出，
// 避免任何 `@/setup` 导入触发其模块求值。
export * from './adapter';
export * from './lifecycle';
export * from './logger';
export * from './middleware';
export * from './ops-panels';
export * from './pipeline';
export * from './plugins';
