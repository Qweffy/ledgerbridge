import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { noopSink } from "../../src/internal/sink";
import { buildServer } from "../../src/server";

describe("admin auth guard", () => {
  let h: TestDb;
  beforeEach(async () => {
    h = await createTestDb();
  });
  afterEach(async () => {
    delete process.env.ADMIN_API_TOKEN;
    await h.close();
  });

  it("is a no-op when ADMIN_API_TOKEN is unset (the sandbox demo stays open)", async () => {
    delete process.env.ADMIN_API_TOKEN;
    const app = buildServer({ db: h.db, sink: noopSink });
    const res = await app.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("401s the admin surface without a valid bearer when the token is set", async () => {
    process.env.ADMIN_API_TOKEN = "s3cret";
    const app = buildServer({ db: h.db, sink: noopSink });

    const noAuth = await app.inject({ method: "GET", url: "/status" });
    expect(noAuth.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "GET",
      url: "/status",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await app.inject({
      method: "GET",
      url: "/status",
      headers: { authorization: "Bearer s3cret" },
    });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("leaves public routes open (health) even when the token is set", async () => {
    process.env.ADMIN_API_TOKEN = "s3cret";
    const app = buildServer({ db: h.db, sink: noopSink });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
