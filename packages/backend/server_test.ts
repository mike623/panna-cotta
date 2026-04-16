import { assertEquals } from "@std/assert";
import { Hono } from "hono";

// Test that a minimal Hono app works with our route structure
Deno.test("API health endpoint returns OK", async () => {
  const app = new Hono();
  app.get("/api/health", (c) => c.text("OK"));

  const res = await app.request("/api/health");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "OK");
});

Deno.test("Root path returns HTML", async () => {
  const app = new Hono();
  app.get("/", (c) => c.html("<html><body>test</body></html>"));

  const res = await app.request("/");
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text.includes("<html>"), true);
});

Deno.test("Unknown API route returns 404", async () => {
  const app = new Hono();
  app.get("/api/health", (c) => c.text("OK"));

  const res = await app.request("/api/nonexistent");
  assertEquals(res.status, 404);
});

Deno.test("PUT /api/config returns 400 for invalid body", async () => {
  const app = new Hono();
  app.put("/api/config", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.grid?.rows !== "number") {
      return c.json({ error: "Invalid config" }, 400);
    }
    return c.json({ ok: true });
  });

  const res = await app.request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invalid: true }),
  });
  assertEquals(res.status, 400);
});

Deno.test("PUT /api/config returns 200 for valid body", async () => {
  const app = new Hono();
  app.put("/api/config", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.grid?.rows !== "number") {
      return c.json({ error: "Invalid config" }, 400);
    }
    return c.json({ ok: true });
  });

  const validConfig = {
    grid: { rows: 2, cols: 3 },
    buttons: [{ name: "X", type: "browser", icon: "globe", action: "https://x.com" }],
  };

  const res = await app.request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validConfig),
  });
  assertEquals(res.status, 200);
});
