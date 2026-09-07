# justfile for nest-forge
# Run `just --list` to view available commands.

set shell := ["bash", "-uc"]
set dotenv-load := true

default:
    @just --list

# ----------------------------------------
# Development
# ----------------------------------------

# Start dev server with embedded worker (single process, watch mode)
dev:
    WORKER_EMBEDDED=true nest start --watch

# Start app + worker concurrently (two separate processes)
dev-all:
    concurrently -k -n app,worker -c bgBlue.bold,bgMagenta.bold -p "[{name}]" -t "HH:mm:ss" "nest start --watch" "nest start --entryFile workers/worker.main --watch"

# Start dev server with debugger
debug:
    bun x nest start --debug --watch

# Build production output (SWC)
build:
    nest build

# Start production build
start:
    node dist/main.js

# Start worker only (production build)
start-worker:
    node dist/workers/worker.main.js

# Start app with embedded worker (single process)
start-embedded:
    WORKER_EMBEDDED=true node dist/main.js

# Start app + worker concurrently (two separate processes)
start-all:
    concurrently -k -n app,worker -c bgBlue.bold,bgMagenta.bold "node dist/main.js" "node dist/workers/worker.main.js"

# ----------------------------------------
# Quality & Test
# ----------------------------------------

# Check code formatting, types and AST architecture rules
check: fix fmt type sg-lint sg-test

# TypeScript type check
type:
    bun x tsc --noEmit

# Lint code
lint:
    bun x biome check src

# Run ast-grep structural architecture lint
sg-lint *args='':
    ast-grep scan {{args}}

# Run ast-grep rule test suite
sg-test *args='':
    ast-grep test {{args}}

# Structural outline for files or directories
outline *args='':
    ast-grep outline {{args}}

# One-click scan for all @deprecated symbols & functions across the project
check-deprecated:
    node scripts/check-deprecated.ts

# Auto-fix lint & formatting
fix:
     bun x biome check --write --no-errors-on-unmatched src tests

# Format code with Biome
fmt:
    bun x biome format --write --no-errors-on-unmatched src tests

# Run unit tests
test:
    bun x vitest run --config vitest.config.mts

# Run unit tests in watch mode
test-watch:
    bun x vitest --config vitest.config.mts

# Open Vitest UI
test-ui:
    bun x vitest --config vitest.config.mts --ui

# Run unit tests with coverage
test-cov:
    bun x vitest run --coverage --config vitest.config.mts

# Run E2E tests
test-e2e:
    bun x vitest run --config vitest.e2e.config.mts

# Debug unit tests with Node inspector (breakpoint debugging)
test-debug *args='':
    bun x vitest --inspect-brk --no-file-parallelism --config vitest.config.mts {{args}}

# ----------------------------------------
# k6 Load & Performance Testing
# ----------------------------------------

# Run k6 load test by scenario (e.g. `just k6 smoke`, `just k6 stress -e BASE_URL=...`)
k6 scenario='smoke' *args='':
    k6 run tests/k6/scenarios/{{scenario}}.js {{args}}

# Run k6 smoke test
k6-smoke *args='':
    k6 run tests/k6/scenarios/smoke.js {{args}}

# Run k6 average load test
k6-load *args='':
    k6 run tests/k6/scenarios/load.js {{args}}

# Run k6 stress test
k6-stress *args='':
    k6 run tests/k6/scenarios/stress.js {{args}}

# Run k6 spike test
k6-spike *args='':
    k6 run tests/k6/scenarios/spike.js {{args}}

# Run k6 soak / endurance test
k6-soak *args='':
    k6 run tests/k6/scenarios/soak.js {{args}}

# Run k6 inside Docker container (no local k6 CLI installation required)
k6-docker scenario='smoke' *args='':
    docker run --rm -i -e BASE_URL="http://host.docker.internal:4300" -v "$(pwd)/tests/k6:/scripts:ro" -v "$(pwd)/storage/logs:/storage/logs" grafana/k6 run /scripts/scenarios/{{scenario}}.js {{args}}

# ----------------------------------------
# Mail templates
# ----------------------------------------

# Compile MJML mail templates to Handlebars (.hbs)
mail-build:
    bash scripts/build-mail.sh

# ----------------------------------------
# Drizzle / Database
# ----------------------------------------

# Generate Drizzle migrations
db-gen:
    bun x drizzle-kit generate

# Run migrations (dev)
db-migrate:
    bun x drizzle-kit migrate

# Deploy migrations (prod)
db-deploy:
    bun x drizzle-kit migrate

# Seed the database
db-seed:
    bun x tsx src/database/seeds/index.ts

# Open Drizzle Studio
db-studio:
    bun x drizzle-kit studio

# Reset database (dev only, destructive — drop schema and re-migrate)
db-reset:
    bun x drizzle-kit drop
    bun x drizzle-kit migrate

# ----------------------------------------
# CLI
# ----------------------------------------

# Run nest-commander CLI from production build (e.g. `just cli jwt:secret`)
cli *args='--help':
    node dist/cli.js {{args}}

# Run nest-commander CLI (builds & runs TS CLI, e.g. `just cmd jwt:secret`)
cmd *args='--help':
    nest build && node dist/cli.js {{args}}

# ----------------------------------------
# Helm
# ----------------------------------------

# Lint Helm chart
helm-lint:
    helm lint ./helm/nestforge

# Validate Helm chart (lint + template + kubeconform)
helm-validate:
    helm lint ./helm/nestforge
    helm template nestforge ./helm/nestforge | kubeconform -summary

# Package Helm chart
helm-package:
    helm package ./helm/nestforge

# Install/upgrade Helm chart to cluster (kubeconfig required)
helm-install *args='--dry-run':
    helm upgrade --install nestforge ./helm/nestforge {{args}}
# Sync secrets to GitHub (requires gh CLI)
sync-secrets:
    bash scripts/sync-secrets.sh