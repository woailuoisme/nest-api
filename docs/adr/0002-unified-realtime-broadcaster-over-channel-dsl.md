# ADR 0002: Unified Realtime Broadcaster Over Custom Channel Routing DSL

- **Status**: Accepted
- **Date**: 2026-08-28

## Context

Real-time capabilities in NestForge encompass both unidirectional streaming (Server-Sent Events via `@Sse()` in `NotificationsModule`) and full-duplex communication (Socket.IO via `@WebSocketGateway()` in `DashboardModule`).

We evaluated whether to create a heavy, Laravel Broadcasting-style unification framework featuring a dynamic channel router (e.g. `routes/channels.ts` and `Broadcast::channel(...)` closures) to simulate a single transport abstraction over both WebSocket and SSE.

## Decision

We decided **against** building a custom dynamic channel routing DSL, and instead established a **lightweight, deep-service Broadcaster pattern (`RealtimeService` in `@Global() RealtimeModule`)** that bridges native transport adapters.

## Rationale & Trade-offs

1. **Protocol Asymmetry & Leaky Abstraction**:
   SSE is strictly unidirectional (HTTP `text/event-stream`), whereas WebSocket is full-duplex TCP with framing, binary support, and client-to-server RPC acknowledgments. Attempting to unify client-to-server interaction under a single protocol abstraction forces either degrading WebSocket capabilities to unidirectional push or inventing synthetic HTTP POST bridging mechanisms.

2. **Framework Alignment with NestJS & Fastify**:
   NestJS is a long-lived Node.js runtime with first-class decorators, guards, validation pipes, and Swagger/OpenAPI generators. Introducing a separate "channel route DSL" mimicking PHP Laravel's request-lifecycle broadcasting would create a disconnected second routing system, bypassing Fastify hooks, NestJS `@UseGuards()`, and standard dependency injection.

3. **High Cohesion, Low Coupling (Deep Module Design)**:
   By establishing `RealtimeService` as a global facade (`sendToUser` and `broadcast`):
   - **Business code** interacts with a single, intuitive emitter without knowing or caring which transport protocol an end-user has connected with.
   - **Transport adapters** (`NotificationsService` and `DashboardGateway`) maintain idiomatic, high-performance implementations leveraging Fastify and Socket.IO Rooms respectively.
   - **Zero friction for clustering**: When scaling across multi-Pod Kubernetes environments, Redis Pub/Sub integration is centralized inside `RealtimeService` rather than scattered across controllers and gateways.

## Consequences

- **Positive**:
  - Business services and BullMQ background jobs simply inject `RealtimeService` for all real-time push needs.
  - Transparent dual-dispatch: user notifications are routed to both SSE streams and WebSocket rooms simultaneously.
  - Zero non-standard routing DSL or reflection complexity.
  - Testability is straightforward: services mock `RealtimeService.sendToUser` without simulating transport handshakes.

- **Negative / Mitigation**:
  - Frontend clients still connect to dedicated transport endpoints (`/v1/notifications/stream` for SSE, `/dashboard` for Socket.IO). *Mitigation*: This aligns with standard web architectural practice where notification feeds and interactive dashboards have distinct connection characteristics and reliability requirements.
