# ADR 0001: Direct BullMQ Queue Jobs Over In-Process EventEmitter

- **Status**: Accepted
- **Date**: 2026-08-28

## Context

NestJS provides an in-memory event publishing module ([`@nestjs/event-emitter`](https://docs.nestjs.com/techniques/events)) built on Node.js `EventEmitter2`. We evaluated whether to introduce `@nestjs/event-emitter` to decouple domain services (such as `AuthService`) from infrastructure side-effects (such as sending verification emails or processing media files).

NestForge already includes a robust, production-grade BullMQ infrastructure (`src/queues/`) backed by Redis. The repository is designed to run in two distinct modes:

1. **Single-Process Embedded Worker**: HTTP server and BullMQ processor co-located (`just dev` / `just start-embedded`).
2. **Dual-Process Distributed Worker**: Standalone HTTP API (`main.ts`) decoupled from dedicated queue worker processes (`worker.main.ts`, via `just dev-all`).

## Decision

We decided **not** to introduce `@nestjs/event-emitter` for business workflows, and instead retain **direct, type-safe invocation of deep BullMQ Queue Jobs** (e.g., `MailJobs`, `MediaJobs`).

## Rationale & Trade-offs

1. **Process Boundary & Distributed Scalability**:
   `EventEmitter2` executes solely within the current Node.js heap. In a multi-replica or split-process architecture (`worker.main.ts`), in-memory events emitted during an HTTP request cannot cross process boundaries to be executed by dedicated worker nodes. BullMQ natively handles process isolation and distributed load-balancing.

2. **Durability & Fault Tolerance**:
   In-memory events are volatile. If a container restarts, crashes, or suffers an OOM event while processing an asynchronous event, the task is permanently lost with zero recovery. BullMQ provides persistence in Redis, exponential backoff retries, and dead-letter queue (DLQ) visibility.

3. **Transaction Safety (Avoiding Ghost Side-Effects)**:
   NestForge strictly enforces atomic database transactions (`await this.db.transaction(...)`). Emitting in-memory events inside an uncommitted transaction risks executing external side-effects (e.g., sending emails) even if the transaction subsequently rolls back due to a constraint violation. Explicit queue dispatch outside the transaction boundary avoids ghost side-effects without requiring an Outbox polling mechanism.

4. **Cognitive Load & Call Traceability**:
   Direct injection of deep facade classes (e.g., `private readonly mailQueue: MailJobs`) provides explicit, compile-time typed, searchable call chains without introducing "action-at-a-distance" where control flow is obscured behind event string/symbol lookups.

## Consequences

- **Positive**:
  - No dual-layer asynchronous indirection (`Service -> Event -> Listener -> Queue Job -> Processor`).
  - Native compatibility with standalone `worker.main.ts` without event bridging.
  - Straightforward unit testing and deterministic mocking of job dispatchers.
  - Zero memory event loss on container restarts.

- **Negative / Mitigation**:
  - Services explicitly reference Queue Job contracts (e.g., `AuthService` depends on `MailJobs`). *Mitigation*: Queue Jobs act as narrow, high-level client facades rather than raw Redis drivers, keeping service coupling minimal and clear.
