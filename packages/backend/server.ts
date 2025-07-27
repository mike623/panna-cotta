import { serve } from "https://deno.land/std/http/server.ts";
import { serveFile } from "https://deno.land/std/http/file_server.ts";
import { join } from "https://deno.land/std/path/mod.ts";

import { executeCommand, getSystemStatus, openApplication } from "./services/system.ts";
import { useStreamDeckConfig } from "./services/config.ts";

const frontendPath = new URL("../frontend", import.meta.url).pathname;

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const config = await useStreamDeckConfig();

  // API routes
  if (path.startsWith("/api")) {
    if (path === "/api/execute" && req.method === "POST") {
      return executeCommand(req);
    } else if (path === "/api/system-status" && req.method === "GET") {
      return getSystemStatus(req);
    } else if (path === "/api/open-app" && req.method === "POST") {
      return openApplication(req);
    } else if (path === "/api/health" && req.method === "GET") {
      return new Response("OK");
    } else if (path === "/api/config" && req.method === "GET") {
      return new Response(JSON.stringify(config), { headers: { "Content-Type": "application/json" } });
    }
  }

  // Serve static files
  try {
    const filePath = join(frontendPath, path);
    const file = await Deno.stat(filePath);
    if (file.isFile) {
      return serveFile(req, filePath);
    } else if (file.isDirectory) {
      // Serve index.html for directories
      return serveFile(req, join(filePath, "index.html"));
    }
  } catch (e) {
    // File not found, continue to next handler or return 404
  }

  // Fallback for unknown routes
  return new Response("Not Found", { status: 404 });
}

console.log("Server running on http://localhost:8000");
Deno.serve({ port: 8000 }, handler);