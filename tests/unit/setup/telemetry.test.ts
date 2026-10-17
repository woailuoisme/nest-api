import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('setup/otel/telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it('未配置 OTEL_EXPORTER_OTLP_ENDPOINT 时零初始化，shutdownTelemetry 为空操作', async () => {
    const { shutdownTelemetry } = await import('@/setup/otel/telemetry');

    // 空操作：不抛错、不产生任何 SDK 副作用
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
