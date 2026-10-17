import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { CircuitBreakerStatus, ResilienceEventType, TrafficPriority } from './enum/index.js';
import { ResilienceEventBus } from './resilience.event-bus.js';

export interface CommandCallMetrics {
  success: number;
  failure: number;
  timeout: number;
  shortCircuit: number;
}

export interface ResilienceMetricsSnapshot {
  circuitBreakers: Record<string, { state: CircuitBreakerStatus; numericState: number }>;
  commandCalls: Record<string, CommandCallMetrics>;
  retryAttempts: Record<string, number>;
  bulkheadRejections: Record<string, number>;
  loadShedDrops: Record<string, Record<string, number>>;
}

@Injectable()
export class ResilienceMetricsRegistry implements OnModuleDestroy {
  private static readonly instance = new ResilienceMetricsRegistry();

  private readonly logger = new Logger(ResilienceMetricsRegistry.name);

  private readonly circuitBreakerStates = new Map<string, CircuitBreakerStatus>();
  private readonly commandCalls = new Map<string, CommandCallMetrics>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly bulkheadRejections = new Map<string, number>();
  private readonly loadShedDrops = new Map<string, Map<string, number>>();

  private readonly boundHandlers: [string, (...args: unknown[]) => void][] = [];

  public static getInstance(): ResilienceMetricsRegistry {
    return ResilienceMetricsRegistry.instance;
  }

  public constructor() {
    this.setupSubscriptions();
  }

  public onModuleDestroy(): void {
    const eventBus = ResilienceEventBus.getInstance();
    for (const [event, handler] of this.boundHandlers) {
      (
        eventBus as unknown as { emitter?: { removeListener: (e: string, fn: unknown) => void } }
      ).emitter?.removeListener(event, handler);
    }
    this.boundHandlers.length = 0;
  }

  public reset(): void {
    this.circuitBreakerStates.clear();
    this.commandCalls.clear();
    this.retryAttempts.clear();
    this.bulkheadRejections.clear();
    this.loadShedDrops.clear();
  }

  public getSnapshot(): ResilienceMetricsSnapshot {
    const circuitBreakers: Record<string, { state: CircuitBreakerStatus; numericState: number }> = {};
    for (const [name, state] of this.circuitBreakerStates.entries()) {
      circuitBreakers[name] = {
        state,
        numericState: this.statusToNumeric(state),
      };
    }

    const commandCalls: Record<string, CommandCallMetrics> = {};
    for (const [name, calls] of this.commandCalls.entries()) {
      commandCalls[name] = { ...calls };
    }

    const retryAttempts: Record<string, number> = {};
    for (const [name, attempts] of this.retryAttempts.entries()) {
      retryAttempts[name] = attempts;
    }

    const bulkheadRejections: Record<string, number> = {};
    for (const [name, count] of this.bulkheadRejections.entries()) {
      bulkheadRejections[name] = count;
    }

    const loadShedDrops: Record<string, Record<string, number>> = {};
    for (const [name, prioMap] of this.loadShedDrops.entries()) {
      loadShedDrops[name] = Object.fromEntries(prioMap.entries());
    }

    return {
      circuitBreakers,
      commandCalls,
      retryAttempts,
      bulkheadRejections,
      loadShedDrops,
    };
  }

  public toPrometheusText(): string {
    const lines: string[] = [];

    // 1. Circuit Breaker States
    lines.push(
      '# HELP resilience_circuit_breaker_state Current state of circuit breaker (0=CLOSED, 1=HALF_OPEN, 2=OPEN)',
    );
    lines.push('# TYPE resilience_circuit_breaker_state gauge');
    for (const [name, state] of this.circuitBreakerStates.entries()) {
      lines.push(`resilience_circuit_breaker_state{name="${this.escapeLabel(name)}"} ${this.statusToNumeric(state)}`);
    }

    // 2. Command Call Counters
    lines.push('# HELP resilience_command_calls_total Total number of resilience command executions by outcome');
    lines.push('# TYPE resilience_command_calls_total counter');
    for (const [name, calls] of this.commandCalls.entries()) {
      const safeName = this.escapeLabel(name);
      lines.push(`resilience_command_calls_total{name="${safeName}",result="success"} ${calls.success}`);
      lines.push(`resilience_command_calls_total{name="${safeName}",result="failure"} ${calls.failure}`);
      lines.push(`resilience_command_calls_total{name="${safeName}",result="timeout"} ${calls.timeout}`);
      lines.push(`resilience_command_calls_total{name="${safeName}",result="short_circuit"} ${calls.shortCircuit}`);
    }

    // 3. Retry Attempts
    lines.push('# HELP resilience_retry_attempts_total Total number of retry attempts executed');
    lines.push('# TYPE resilience_retry_attempts_total counter');
    for (const [name, attempts] of this.retryAttempts.entries()) {
      lines.push(`resilience_retry_attempts_total{name="${this.escapeLabel(name)}"} ${attempts}`);
    }

    // 4. Bulkhead Rejections
    lines.push(
      '# HELP resilience_bulkhead_rejected_total Total number of calls rejected by bulkhead concurrency limits',
    );
    lines.push('# TYPE resilience_bulkhead_rejected_total counter');
    for (const [name, rejections] of this.bulkheadRejections.entries()) {
      lines.push(`resilience_bulkhead_rejected_total{name="${this.escapeLabel(name)}"} ${rejections}`);
    }

    // 5. Load Shed Drops
    lines.push('# HELP resilience_load_shed_dropped_total Total number of requests shed due to high system load');
    lines.push('# TYPE resilience_load_shed_dropped_total counter');
    for (const [name, prioMap] of this.loadShedDrops.entries()) {
      const safeName = this.escapeLabel(name);
      for (const [priority, count] of prioMap.entries()) {
        lines.push(
          `resilience_load_shed_dropped_total{name="${safeName}",priority="${this.escapeLabel(priority)}"} ${count}`,
        );
      }
    }

    return `${lines.join('\n')}\n`;
  }

  private setupSubscriptions(): void {
    const eventBus = ResilienceEventBus.getInstance();

    const subscribe = (event: ResilienceEventType, handler: (...args: unknown[]) => void) => {
      this.boundHandlers.push([event, handler]);
      eventBus.on(event, handler as unknown as (args: unknown) => void);
    };

    // Circuit Breaker state changes
    subscribe(ResilienceEventType.CircuitBreakerStateChanged, (payload) => {
      const [cmd, from, to, reason] =
        this.normalizePayload<[unknown, CircuitBreakerStatus, CircuitBreakerStatus, string?]>(payload);
      const name = this.resolveCommandName(cmd);
      this.circuitBreakerStates.set(name, to);

      if (to === CircuitBreakerStatus.Open) {
        this.logger.warn({
          msg: `Circuit breaker tripped to OPEN [${name}]`,
          command: name,
          from,
          to,
          reason,
        });
      } else if (to === CircuitBreakerStatus.HalfOpen) {
        this.logger.log({
          msg: `Circuit breaker entered trial HALF_OPEN [${name}]`,
          command: name,
          from,
          to,
        });
      } else if (to === CircuitBreakerStatus.Closed) {
        this.logger.log({
          msg: `Circuit breaker recovered to CLOSED [${name}]`,
          command: name,
          from,
          to,
        });
      }
    });

    // Command Call Metrics
    subscribe(ResilienceEventType.Success, (payload) => {
      const [cmd] = this.normalizePayload<[unknown]>(payload);
      this.incrementCallMetric(this.resolveCommandName(cmd), 'success');
    });

    subscribe(ResilienceEventType.Failure, (payload) => {
      const [cmd] = this.normalizePayload<[unknown]>(payload);
      this.incrementCallMetric(this.resolveCommandName(cmd), 'failure');
    });

    subscribe(ResilienceEventType.Timeout, (payload) => {
      const [cmd] = this.normalizePayload<[unknown]>(payload);
      this.incrementCallMetric(this.resolveCommandName(cmd), 'timeout');
    });

    subscribe(ResilienceEventType.ShortCircuit, (payload) => {
      const [cmd] = this.normalizePayload<[unknown]>(payload);
      this.incrementCallMetric(this.resolveCommandName(cmd), 'shortCircuit');
    });

    // Retry Attempts
    subscribe(ResilienceEventType.RetryAttempt, (payload) => {
      const [cmd] = this.normalizePayload<[unknown, number, number, unknown]>(payload);
      const name = this.resolveCommandName(cmd);
      this.retryAttempts.set(name, (this.retryAttempts.get(name) ?? 0) + 1);
    });

    // Bulkhead Rejections
    subscribe(ResilienceEventType.BulkheadRejected, (payload) => {
      const [cmd] = this.normalizePayload<[unknown, number, number]>(payload);
      const name = this.resolveCommandName(cmd);
      this.bulkheadRejections.set(name, (this.bulkheadRejections.get(name) ?? 0) + 1);
    });

    // Load Shed Drops
    subscribe(ResilienceEventType.LoadShedDrop, (payload) => {
      const [cmd, priority, reason] = this.normalizePayload<[unknown, TrafficPriority, string]>(payload);
      const name = this.resolveCommandName(cmd);
      const prioStr = String(priority ?? TrafficPriority.DEFAULT);

      let prioMap = this.loadShedDrops.get(name);
      if (!prioMap) {
        prioMap = new Map();
        this.loadShedDrops.set(name, prioMap);
      }
      prioMap.set(prioStr, (prioMap.get(prioStr) ?? 0) + 1);

      this.logger.warn({
        msg: `Execution dropped by load shedding [${name}]`,
        command: name,
        priority: prioStr,
        reason,
      });
    });
  }

  private incrementCallMetric(name: string, key: keyof CommandCallMetrics): void {
    let metrics = this.commandCalls.get(name);
    if (!metrics) {
      metrics = { success: 0, failure: 0, timeout: 0, shortCircuit: 0 };
      this.commandCalls.set(name, metrics);
    }
    metrics[key]++;
  }

  private normalizePayload<T extends unknown[]>(payload: unknown): T {
    if (Array.isArray(payload)) {
      return payload as T;
    }
    return [payload] as unknown as T;
  }

  private resolveCommandName(command: unknown): string {
    if (!command) return 'default';
    if (typeof command === 'string') return command;
    if (typeof command === 'object' && 'name' in command && typeof command.name === 'string') {
      const grp = 'group' in command && typeof command.group === 'string' ? command.group : undefined;
      return grp ? `${grp}#${command.name}` : command.name;
    }
    if (typeof command === 'object' && 'toString' in command && typeof command.toString === 'function') {
      const str = command.toString();
      if (str !== '[object Object]') return str;
    }
    return 'default';
  }

  private statusToNumeric(status: CircuitBreakerStatus): number {
    switch (status) {
      case CircuitBreakerStatus.Closed:
        return 0;
      case CircuitBreakerStatus.HalfOpen:
        return 1;
      case CircuitBreakerStatus.Open:
        return 2;
      default:
        return 0;
    }
  }

  private escapeLabel(val: string): string {
    return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}
