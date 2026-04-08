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
