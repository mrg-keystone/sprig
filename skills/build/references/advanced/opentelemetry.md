# OpenTelemetry

> Source: https://fresh.deno.dev/docs/advanced/opentelemetry

## TL;DR
Fresh emits OTel spans for middleware, handlers, SSR, static-file serving, and dynamic route loading — no code changes needed. Configure an exporter via env vars; without one, spans are silently discarded.

## Auto-instrumented
- Each middleware in the chain
- Route handler invocations
- Server-side rendering
- Static file serving
- Dynamic route module loading

All spans use the `fresh` tracer. Root spans include `http.route` (the matched pattern).

## Span attributes
- `http.route`
- `fresh.span_type`
- `fresh.cache` (static-file cache status)

Errors → `span.recordException()` + status `ERROR`.

## Enable
No code change. Set env vars:
```
OTEL_DENO=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_TRACES_EXPORTER=console      # to stderr, for local dev
```
Deno 2.7+ has built-in OTel support.

## Local dev options
- **Console exporter** — `OTEL_TRACES_EXPORTER=console`
- **Jaeger** — run via Docker, point OTLP endpoint at it

## Custom spans
Use `@opentelemetry/api` directly — Fresh's tracer will be ambient.

## Client correlation
Fresh injects W3C Trace Context into the page `<head>` so client-side RUM tools can stitch SSR → page-load timelines.

## See also
- `advanced/api-reference.md`
