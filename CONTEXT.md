# Domain Model: NestForge

This document establishes the ubiquitous language and domain glossary for NestForge.

## Core Concepts

### Identity & Access

- **User**: The unified account identity across client and back-office management, identified by a UUIDv7 primary key and unique email. Supports role-based access (`Role`: SUPER_ADMIN, ADMIN, OPERATOR, USER).
- **Role**: Coarse-grained access tier assigned to users (`SUPER_ADMIN`, `ADMIN`, `OPERATOR`, `USER`).
- **Permission**: Fine-grained capability string (e.g., `users.create`, `users.read`) derived deterministically from role mapping (`ROLE_PERMISSIONS`).
- **AccessControlGuard**: Unified high-performance authorization guard evaluating `@Public()`, `@Roles()`, and `@Permissions()` in a single pass with ADMIN/SUPER_ADMIN super-role short-circuiting.

### Identifiers & Traceability

- **UUIDv7 Standard (RFC 9562)**: Time-ordered 128-bit identifier with a 48-bit millisecond Unix timestamp prefix and monotonic sub-millisecond sequencing. Guarantees clustered B-tree index locality without page splitting while providing non-enumerable, collision-free distributed identity. Adopted directly as the primary identifier across core and standalone entities (`user`, `session`, `account`, `verification`, `notifications`, `media`, `orders`).
- **RequestId (`x-request-id`)**: End-to-end distributed trace identifier formatted as a standard 36-character `UUIDv7`. Injected at the Fastify hook boundary, propagated across downstream logs (Pino), error envelopes, and HTTP response headers.
- **IdempotencyKey**: Client-originated unique token (recommended `UUIDv7`) transmitted via the `Idempotency-Key` HTTP header. The server treats this as an opaque `varchar(255)` string, enforcing single-execution semantics scoped to `(key, request_path, actor_type, user_id)`.

### API Surface & Admin Boundary

- **Admin Boundary**: The `/admin` route prefix segregating back-office management endpoints from front-end API endpoints. The users, notifications, and dashboard management domains live exclusively under this boundary.
- **AdminPrefixGuard**: Default-deny global guard registered in the APP_GUARD chain, enforcing admin roles (`SUPER_ADMIN`, `ADMIN`, `OPERATOR`) for any request hitting the `/admin` prefix (with `/v1/admin` URI versioning support), while honoring `@Public()` on whitelisted endpoints.
- **AdminModule**: Sole back-office entry in `API_MODULES` aggregating self-contained domain submodules under `src/api/admin/` (the admin boundary area alongside `src/api/client/` and `src/api/system/`), plus any domain module auto-generated and auto-registered by `crud:generate`. New management endpoints must be added here, never to front-end controllers.
- **Front-end (Client) API Module**: Feature module exposing only self-service endpoints for end-user clients under `src/api/client/`. The front-end `UsersModule` (`GET /users/me`, `GET /users/:id`, avatar upload) has zero dependency on the admin domain; route-level security for the admin surface stays enforced by `AdminPrefixGuard`.
- **System API Module**: Infrastructure-adjacent endpoints (e.g. health checks) under `src/api/system/`.

### Authentication & Session Lifecycle

- **BetterAuthModule**: High-performance native NestJS module integrating Better Auth over Fastify 5 without third-party proxy wrappers, exposing `/v1/auth/*` catch-all handler and Drizzle ORM PostgreSQL persistence.
- **Session**: Stateful authentication session record stored in PostgreSQL, supporting multi-device tracking, instant revocation, and dual-modality access (HTTP-Only Cookie and Bearer session token).
- **BetterAuthGuard**: Global authentication guard inspecting incoming HTTP-Only cookies and Bearer tokens via Better Auth session API, attaching authenticated user and session context onto `request.user` and `request.session`.

### Asynchronous Operations

- **Queue Job**: BullMQ background task contract produced during business operations (e.g., `mail`, `token-cleanup`, `media`).
- **MediaJob / MediaProcessor**: BullMQ background queue producer and consumer executing off-thread Sharp image transformations and multi-variant thumbnail generation without blocking HTTP event loops or inflating Redis memory.
- **Schedule**: Recurring cron or interval triggers executing maintenance workflows (e.g., expired token purging).
- **Worker**: Standalone background Node.js process consuming BullMQ queues without an HTTP server.

### Real-time Streaming & Server-Sent Events

- **Server-Sent Events (SSE)**: W3C standard unidirectional HTTP response stream (`text/event-stream`) providing persistent real-time server-to-client event delivery over standard HTTP/2 or Fastify HTTP/1.1 connections.
- **SseAuthGuard**: Dual-channel authentication guard supporting query token extraction (`?token=<token>`) to accommodate browser `EventSource` header limitations alongside fallback `Authorization: Bearer` parsing and Better Auth session validation.
- **NotificationStream**: Reactive RxJS `Subject`-backed user unicast and broadcast channel, delivering JSON event envelopes with automatic 25s ping heartbeats, Fastify disconnect cleanup, and `@BypassTransform()` response protection.

### Bidirectional WebSockets & Unified Broadcasting

- **WebSocketGateway**: Full-duplex bidirectional communication channel powered by Socket.IO (`/realtime` namespace), supporting room isolation, RPC acknowledgments, and Fastify HTTP server integration via `IoAdapter`.
- **Fail-Fast Handshake Authentication**: Immediate Better Auth session verification during connection initiation via `client.handshake.auth.token`, `headers.authorization`, or `query.token`, instantly aborting unauthenticated connections (`client.disconnect(true)`) to protect TCP handles.
- **MetricChannel**: Dedicated pub/sub rooms (`system`, `business`, `alerts`) allowing authenticated clients to dynamically subscribe to real-time runtime snapshots and business alerts.
- **RealtimeBroadcaster**: Unified deep facade module (`RealtimeService` in `src/realtime/`) providing an ultra-compact public interface (`sendToUser`, `broadcast`, `subscribe`) over the polymorphic `REALTIME_PRIMARY_TRANSPORT` seam. Consolidates generic SSE streaming (`GET /v1/realtime/stream`) and generic WebSocket connections (`/realtime` namespace), backed by `LocalCompositeTransport` (composing `SseTransport`, `RealtimeGateway`, and `RedisPubSubAdapter`) or `PusherTransport`.
- **ChannelManager**: Dynamic channel authorization engine in `src/realtime/channels/` supporting parametric pattern rules (`private:user.{userId}`), role-based wildcard rules (`private:admin.*`), and public room defaults, safeguarding both WebSocket rooms and SSE event streams against unauthorized cross-user eavesdropping.
- **PrivateChannel**: Access-controlled Socket.IO room prefix requiring affirmative evaluation from a registered `ChannelAuthorizer` before a connected socket is permitted to join.
- **PusherTransport**: Pluggable industrial-grade broadcast driver (`BROADCAST_DRIVER="pusher"`, `REALTIME_URL="pusher://..."`) delegating socket state and client connections to an external Soketi or Pusher cluster, delivering zero-downtime rolling deploys and native `laravel-echo` / `pusher-js` SDK interoperability via `POST /v1/realtime/auth` and `/broadcasting/auth`.

### Validation & Data Transfer

- **ZodDto**: Single Source of Truth schema-backed DTO defined using Zod 4 schemas and `createZodDto`, providing unified compile-time typing, runtime validation (`CustomZodValidationPipe` mapped to 422 `UNPROCESSABLE_ENTITY`), and OpenAPI 3.1 generation via `cleanupOpenApiDoc`.
- **ResponseEnvelope**: Standardized JSON representation for successful API interactions (`{ data: T }` or `{ data: T[], meta: PageMetaResource }`), adhering to pure RESTful design without redundant wrapper fields (`success`, `code`, `message`).
- **ErrorEnvelope**: Unified error payload (`{ error: { code, message, fields? } }`) dispatched by `HttpExceptionFilter` for client-side field validation and error handling, decoupling `x-request-id` into HTTP response headers.

### Storage & Media Pipeline

- **StorageDriver**: Underlying file I/O abstraction supporting `local` disk and multi-cloud `s3` (Garage / MinIO / AWS S3) with bidirectional path/URL translation.
- **MediaService**: High-level media transformation and lifecycle manager providing strategy-based path generation (`date-uuid`, `hash`, `slug-random`, `custom`), `sharp`-powered WebP conversion, multi-variant thumbnail generation (`variants`), QR code generation (PNG, WebP, SVG, logo compositing, direct-to-storage), and transactional compensation against orphan files (`storeWithCompensation`).
- **MediaUploadResult**: Structured media result containing primary file path/URL, derivative variant mapping (`variants`), and image metadata (dimensions, format, alpha, aspect ratio).

### Observability & Log Streaming

- **LogReader**: Deep log processing and query engine providing safe file access, structured JSON/plain text parsing, and multi-dimensional filtering.
- **ReverseChunkReader**: High-throughput backward EOF block scanner with early-exit termination, delivering $O(1)$ memory consumption and sub-millisecond pagination over arbitrary-sized log files.
- **LogStatIndexCache**: Memory-efficient incremental metadata and level-tally cache keyed by `(mtime, size)`, eliminating redundant full-file scans across pagination passes.
- **LogTailWatcher**: Reactive asynchronous generator streaming real-time file appends over Server-Sent Events (SSE) directly to the web client.

### Operations Panels

- **OpsPanels**: Deep orchestration module (`registerOpsPanels` in `src/setup/ops-panels.ts`) mounting the runtime operations dashboards — BullBoard queue dashboard, Web Log Viewer, and Scalar API documentation — behind a single `MountedPanel[]` result, centralizing the production access gates (credential-less panels refuse to mount in production) and the `SWAGGER_ENABLED` switch.

### Performance Testing & Load Simulation

- **Workflow**: Sequential deterministic user behavior pipeline executing health probe check (`/health`), authenticated profile query (`/users/me`), and data pagination (`/users?page=...`).
- **ScenarioRunner**: Standardized scenario factory mapping k6 execution profiles and SLA thresholds to workflow execution with automated HTML/JSON report generation.
