import 'dotenv/config';
import FastifyOtelInstrumentation from '@fastify/otel';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const isOtelEnabled = process.env.OTEL_ENABLED === 'true';

if (isOtelEnabled) {
  const serviceName = process.env.OTEL_SERVICE_NAME || 'nest-forge';
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';

  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
    }),
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // 过滤高频且噪声巨大的低价值 I/O instrumentation
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
      new FastifyOtelInstrumentation({ registerOnInitialization: true }),
    ],
  });

  sdk.start();

  const shutdown = () => {
    sdk
      .shutdown()
      .then(() => {
        // SDK 优雅停机完成
      })
      .catch((err) => {
        process.stderr.write(`Error shutting down OpenTelemetry SDK: ${String(err)}\n`);
      });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
