import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { withSpan } from "../../src/telemetry";

// The global tracer provider can only be registered once per process, so register a
// single in-memory provider for the file and reset the exporter between tests. (Other
// test files run isolated with no provider, so their withSpan calls stay no-ops.)
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  provider.register();
});
afterEach(() => {
  exporter.reset();
});
afterAll(async () => {
  await provider.shutdown();
});

describe("withSpan", () => {
  it("emits a named span with attributes and returns the fn result", async () => {
    const result = await withSpan("test.op", { "a.key": "v", n: 1, skipped: undefined }, async () => 42);
    expect(result).toBe(42);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("test.op");
    expect(spans[0]?.attributes["a.key"]).toBe("v");
    expect(spans[0]?.attributes.n).toBe(1);
    expect(spans[0]?.attributes).not.toHaveProperty("skipped");
  });

  it("records the exception, marks the span errored, and rethrows", async () => {
    await expect(
      withSpan("test.fail", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(spans[0]?.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("nests child spans under the parent (sync.process_event → qbo.request)", async () => {
    await withSpan("parent", {}, async () => {
      await withSpan("child", {}, async () => undefined);
    });
    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === "parent");
    const child = spans.find((s) => s.name === "child");
    expect(parent && child).toBeTruthy();
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });
});
