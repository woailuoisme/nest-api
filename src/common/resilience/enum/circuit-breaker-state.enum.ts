export enum CircuitBreakerStatus {
  Closed = 'Closed',
  HalfOpen = 'HalfOpen',
  Open = 'Open',
}

export const CircuitBreakerState = CircuitBreakerStatus;
export type CircuitBreakerState = CircuitBreakerStatus;

export const CircuitState = {
  Closed: 'Closed',
  HalfOpen: 'HalfOpen',
  Open: 'Open',
  Isolated: 'Isolated',
  CLOSED: 'Closed',
  HALF_OPEN: 'HalfOpen',
  OPEN: 'Open',
  ISOLATED: 'Isolated',
} as const;

export type CircuitState = (typeof CircuitState)[keyof typeof CircuitState];
