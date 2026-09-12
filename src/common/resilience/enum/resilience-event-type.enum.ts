export enum ResilienceEventType {
  Emit = 'emit',
  Failure = 'failure',
  ShortCircuit = 'shortCircuit',
  Success = 'success',
  Timeout = 'timeout',
  CircuitBreakerStateChanged = 'circuitBreakerStateChanged',
  RetryAttempt = 'retryAttempt',
  BulkheadRejected = 'bulkheadRejected',
  LoadShedDrop = 'loadShedDrop',
}
