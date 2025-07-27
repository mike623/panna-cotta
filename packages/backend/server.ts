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

  // Serve the config page on the root path
  if (path === "/") {
    const interfaces = Deno.networkInterfaces();
    let localIp = "localhost";
    for (const iface of interfaces) {
        if (iface.family === "IPv4" && iface.address !== "127.0.0.1") {
          localIp = iface.address;
          break;
        }
    }
    const appUrl = `http://${localIp}:8000/apps`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(appUrl)}`;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Stream Deck Backend Config</title>
          <style>
              body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background-color: #f0f0f0; }
              .container { background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
              img { margin-top: 20px; border: 1px solid #eee; }
              p { margin-top: 20px; font-size: 1.1em; }
              code { background-color: #e9e9e9; padding: 5px 8px; border-radius: 4px; }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>Stream Deck Backend Config</h1>
              <p>Scan the QR code below with your mobile device to access the Stream Deck frontend:</p>
              <img src="${qrCodeUrl}" alt="QR Code for Stream Deck App">
              <p>Or navigate to:</p>
              <code>${appUrl}</code>
          </div>
      </body>
      </html>
    `;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

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

  // Serve frontend static files under /apps
  if (path.startsWith("/apps")) {
    try {
      const filePath = join(frontendPath, path.substring(5)); // Remove /apps from path
      const file = await Deno.stat(filePath);
      if (file.isFile) {
        return serveFile(req, filePath);
      } else if (file.isDirectory) {
        return serveFile(req, join(filePath, "index.html"));
      }
    } catch (e) {
      // File not found, continue to next handler or return 404
    }
  }

  // Fallback for unknown routes
  return new Response("Not Found", { status: 404 });
}

console.log("Server running on http://localhost:8000");
Deno.serve({ port: 8000 }, handler);