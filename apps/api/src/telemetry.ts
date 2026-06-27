import { SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import type { FastifyInstance, FastifyRequest } from "fastify";

const TRACER_NAME = "ledgerbridge";
let started = false;

// Tracing is opt-in. With OTEL_ENABLED set we register a real provider; otherwise the
// @opentelemetry/api no-op tracer is used, so every span below costs nothing and the
// test suite stays silent. ConsoleSpanExporter by default; OTLP/HTTP when
// OTEL_EXPORTER_OTLP_ENDPOINT points at a collector (Jaeger, Honeycomb, …). The SDK
// itself is dynamically imported so it's only loaded when enabled.
export async function startTelemetry(): Promise<void> {
  if (started || !process.env.OTEL_ENABLED) return;
  started = true;
  const { NodeTracerProvider, BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter } =
    await import("@opentelemetry/sdk-trace-node");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  let processor;
  if (endpoint) {
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    processor = new BatchSpanProcessor(new OTLPTraceExporter());
  } else {
    processor = new SimpleSpanProcessor(new ConsoleSpanExporter());
  }
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "ledgerbridge-api" }),
    spanProcessors: [processor],
  });
  provider.register();
}

function tracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

type Attrs = Record<string, string | number | boolean | undefined>;

// Run `fn` inside an active span, setting attributes, recording any thrown error, and
// always ending the span. Nested withSpan calls form a parent/child trace (e.g.
// sync.process_event → qbo.request). A no-op passthrough until a provider is registered.
export async function withSpan<T>(name: string, attributes: Attrs, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer().startActiveSpan(name, async (span) => {
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== undefined) span.setAttribute(k, v);
    }
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

// One span per HTTP request, keyed off the route template (not req.url) so a query
// string — e.g. the OAuth `code` — never lands in a span name. No-op spans when tracing
// is off, so this is safe to register unconditionally.
const requestSpans = new WeakMap<FastifyRequest, Span>();
export function registerHttpTracing(app: FastifyInstance): void {
  app.addHook("onRequest", async (req) => {
    const route = req.routeOptions?.url ?? req.url.split("?")[0];
    requestSpans.set(req, tracer().startSpan(`${req.method} ${route}`, { attributes: { "http.method": req.method, "http.route": route } }));
  });
  app.addHook("onResponse", async (req, reply) => {
    const span = requestSpans.get(req);
    if (!span) return;
    span.setAttribute("http.status_code", reply.statusCode);
    if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    requestSpans.delete(req);
  });
}
