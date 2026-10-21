/**
 * OpenTelemetry 初始化（副作用模块）：traces + metrics 经 OTLP/HTTP+protobuf 推送 otel-collector。
 *
 * 入口级先导模式：main / worker / cli 入口最先导入本模块，借助 top-level await 确保在其余业务模块（http/fastify）加载前完成探针注册。
 *
 * 未配置 `OTEL_EXPORTER_OTLP_ENDPOINT` 时不初始化（动态 import 均不执行）：
 * 本地与测试环境零配置可用、零依赖加载开销。
 *
 * ponytail: 纯 ESM 产物下 require-hook 类探针（ioredis/pg 等）无法 patch，
 * 生效的是 diagnostics-channel 类探针（HTTP server spans 由 @fastify/otel 承担、出站 fetch 由 undici 探针承担）；
 * 如需完整覆盖需引入 --experimental-loader hook（Node 24 有已知挂起 issue，暂不启用）。
 */
import { appName } from '@/common/constants/app.constants';
import { resolveServiceName } from '@/setup/logger/logger.config';

import { createRedactingExporter } from './redacting-exporter';

/**
 * OTel `service.name`：`<APP_NAME>-<role>`，便于同一应用按进程角色区分。
 *
 * 应用名已以角色结尾时不再重复追加（APP_NAME=nest-api + api → nest-api）。
 */
function resolveOtelServiceName(): string {
  const role = resolveServiceName();
  const base = appName();
  return base.endsWith(`-${role}`) ? base : `${base}-${role}`;
}

let sdk: import('@opentelemetry/sdk-node').NodeSDK | undefined;

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const [
    { NodeSDK },
    { getNodeAutoInstrumentations },
    { FastifyOtelInstrumentation },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { PeriodicExportingMetricReader },
    { defaultResource, resourceFromAttributes },
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/auto-instrumentations-node'),
    import('@fastify/otel'),
    import('@opentelemetry/exporter-trace-otlp-proto'),
    import('@opentelemetry/exporter-metrics-otlp-proto'),
    import('@opentelemetry/sdk-metrics'),
    import('@opentelemetry/resources'),
  ]);

  sdk = new NodeSDK({
    // defaultResource 保留 env 探测与 telemetry.sdk.* 基础属性，显式属性覆盖同名项
    resource: defaultResource().merge(
      resourceFromAttributes({
        'service.name': process.env.OTEL_SERVICE_NAME ?? resolveOtelServiceName(),
        'deployment.environment.name': process.env.APP_ENV ?? 'development',
      }),
    ),
    // endpoint/headers/采样率均沿用官方标准 env（OTEL_EXPORTER_OTLP_* / OTEL_TRACES_SAMPLER*）
    // 导出前捕获一层脱敏：抹掉把凭据放在 query 的第三方网关 URL
    traceExporter: createRedactingExporter(new OTLPTraceExporter()),
    // 复数形态（IMetricReader[]）：单数 metricReader 已在 sdk-node 0.300 移除
    metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })],
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs 探针产生海量无价值 spans，显式关闭
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
      // registerOnInitialization 经 diagnostics channel 自动挂接所有 Fastify 实例（含 Bull Board）
      new FastifyOtelInstrumentation({ registerOnInitialization: true }),
    ],
  });
  sdk.start();
}

/**
 * 优雅关停：flush 未落盘的 spans 与 metrics。
 *
 * 失败仅写 stderr（刻意不用 pino，避免停机期再次依赖）；
 * 部署期配置错误（endpoint/认证头错误）常在此暴露，不容忍盲区。
 */
export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown().catch((err: unknown) => {
    process.stderr.write(`[Telemetry] shutdown/flush failed: ${String(err)}\n`);
  });
}
