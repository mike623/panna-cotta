import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveDir } from "@std/http/file-server";
import {
  executeCommand,
  getSystemStatus,
  openApplication,
  openUrl,
} from "./services/system.ts";
import { saveStreamDeckConfig, useStreamDeckConfig, configSchema } from "./services/config.ts";

const app = new Hono();

app.use("*", logger());
app.use("*", compress());
app.use("/api/*", cors());

// --- API routes ---

app.post("/api/execute", (c) => executeCommand(c.req.raw));
app.get("/api/system-status", (c) => getSystemStatus(c.req.raw));
app.post("/api/open-app", (c) => openApplication(c.req.raw));
app.post("/api/open-url", (c) => openUrl(c.req.raw));
app.get("/api/health", (c) => c.text("OK"));

app.get("/api/config", async (c) => {
  const config = await useStreamDeckConfig();
  return c.json(config);
});

app.put("/api/config", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  try {
    await saveStreamDeckConfig(parsed.data);
  } catch (err) {
    return c.json({ error: `Failed to write config: ${String(err)}` }, 500);
  }

  return c.json({ ok: true, config: parsed.data });
});

// --- Config / landing page ---

function getLocalIp(): string {
  try {
    const interfaces = Deno.networkInterfaces();
    for (const iface of interfaces) {
      if (iface.family === "IPv4" && iface.address !== "127.0.0.1") {
        return iface.address;
      }
    }
  } catch {
    // networkInterfaces may not be available
  }
  return "localhost";
}

app.get("/", (c) => {
  const port = parseInt(Deno.env.get("STREAM_DECK_PORT") || "8000");
  const localIp = getLocalIp();
  const appUrl = `http://${localIp}:${port}/apps`;
  const qrCodeUrl =
    `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${
      encodeURIComponent(appUrl)
    }`;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panna Cotta — Setup</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #111; color: #eee; }
    .card { background: #1a1a2e; padding: 2rem; border-radius: 1rem; text-align: center; max-width: 400px; }
    h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
    p { color: #aaa; line-height: 1.5; }
    img { margin: 1.5rem 0; border-radius: 0.5rem; }
    code { background: #2a2a3e; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.9rem; }
    a { color: #818cf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Panna Cotta</h1>
    <p>Scan the QR code with your phone to open the Stream Deck:</p>
    <img src="${qrCodeUrl}" alt="QR Code" width="200" height="200">
    <p>Or open: <a href="${appUrl}"><code>${appUrl}</code></a></p>
  </div>
</body>
</html>`);
});

// --- Static frontend files ---

const frontendPath = new URL("../frontend", import.meta.url).pathname;

app.get("/apps/*", (c) => {
  return serveDir(c.req.raw, { fsRoot: frontendPath, urlRoot: "apps" });
});

// --- Start server ---

const port = parseInt(Deno.env.get("STREAM_DECK_PORT") || "8000");
console.log(`Panna Cotta running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
