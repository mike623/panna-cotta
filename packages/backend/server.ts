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
import {
  configSchema,
  saveStreamDeckConfig,
  useStreamDeckConfig,
} from "./services/config.ts";

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
    return c.json({ error: "Invalid config", details: parsed.error.flatten() }, 400);
  }

  try {
    await saveStreamDeckConfig(parsed.data);
  } catch (err) {
    return c.json({ error: `Failed to write config: ${String(err)}` }, 500);
  }

  return c.json({ ok: true, config: parsed.data });
});

app.get("/admin", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panna Cotta — Admin</title>
  <meta name="color-scheme" content="dark">
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; margin: 0; padding: 1.5rem; }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { margin: 0 0 1.5rem; font-size: 1.5rem; }
    h2 { margin: 1.5rem 0 0.75rem; font-size: 0.8rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.08em; }
    .card { background: #1a1a2e; padding: 1rem; border-radius: 0.75rem; margin-bottom: 0.5rem; }
    .row { display: flex; gap: 0.75rem; align-items: flex-start; }
    .field { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
    label { font-size: 0.75rem; color: #888; }
    input, select { background: #2a2a3e; border: 1px solid #3a3a5e; color: #eee; padding: 0.5rem 0.75rem; border-radius: 0.5rem; width: 100%; font-size: 0.9rem; }
    input:focus, select:focus { outline: 1px solid #818cf8; border-color: #818cf8; }
    button { background: #4f46e5; color: #fff; border: none; padding: 0.5rem 1.25rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.9rem; }
    button:hover { background: #6366f1; }
    button.danger { background: transparent; color: #f87171; border: 1px solid #f87171; padding: 0.4rem 0.75rem; }
    button.danger:hover { background: #7f1d1d; }
    button.ghost { background: #2a2a3e; color: #eee; padding: 0.4rem 0.6rem; }
    button.ghost:hover { background: #3a3a5e; }
    button:disabled { opacity: 0.3; cursor: default; }
    .btn-row { margin-top: 0.75rem; display: flex; gap: 0.5rem; justify-content: flex-end; }
    .save-row { margin-top: 1.5rem; display: flex; align-items: center; gap: 1rem; }
    .toast { font-size: 0.9rem; }
    .toast.ok { color: #4ade80; }
    .toast.err { color: #f87171; }
    .grid-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    a { color: #818cf8; text-decoration: none; font-size: 0.9rem; }
    a:hover { text-decoration: underline; }
    .back { display: block; margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back">← Back</a>
    <h1>Admin</h1>

    <h2>Grid</h2>
    <div class="card">
      <div class="grid-fields">
        <div class="field">
          <label>Rows</label>
          <input type="number" id="grid-rows" min="1" max="10" value="2">
        </div>
        <div class="field">
          <label>Cols</label>
          <input type="number" id="grid-cols" min="1" max="10" value="3">
        </div>
      </div>
    </div>

    <h2>Buttons</h2>
    <div id="buttons-list"></div>

    <div class="card">
      <h2 style="margin-top:0">Add Button</h2>
      <div class="row">
        <div class="field"><label>Name</label><input type="text" id="new-name" placeholder="GitHub"></div>
        <div class="field"><label>Type</label>
          <select id="new-type">
            <option value="browser">browser</option>
            <option value="system">system</option>
          </select>
        </div>
      </div>
      <div class="row" style="margin-top:0.5rem">
        <div class="field"><label>Icon (Lucide name)</label><input type="text" id="new-icon" placeholder="github"></div>
        <div class="field"><label>Action (URL or app name)</label><input type="text" id="new-action" placeholder="https://github.com"></div>
      </div>
      <div class="btn-row" style="justify-content:flex-start;margin-top:0.75rem">
        <button onclick="addButton()">Add Button</button>
      </div>
    </div>

    <div class="save-row">
      <button onclick="saveConfig()">Save</button>
      <span id="toast" class="toast"></span>
    </div>
  </div>

  <script>
    let buttons = [];

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) { showToast('Failed to load config', false); return; }
        const config = await res.json();
        document.getElementById('grid-rows').value = config.grid.rows;
        document.getElementById('grid-cols').value = config.grid.cols;
        buttons = config.buttons || [];
        renderButtons();
      } catch {
        showToast('Network error', false);
      }
    }

    function renderButtons() {
      const list = document.getElementById('buttons-list');
      list.innerHTML = '';
      buttons.forEach((btn, i) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <div class="row">
            <div class="field"><label>Name</label><input type="text" value="\${escHtml(btn.name)}" oninput="buttons[\${i}].name=this.value"></div>
            <div class="field"><label>Type</label>
              <select onchange="buttons[\${i}].type=this.value">
                <option value="browser" \${btn.type==='browser'?'selected':''}>browser</option>
                <option value="system" \${btn.type==='system'?'selected':''}>system</option>
              </select>
            </div>
          </div>
          <div class="row" style="margin-top:0.5rem">
            <div class="field"><label>Icon</label><input type="text" value="\${escHtml(btn.icon)}" oninput="buttons[\${i}].icon=this.value"></div>
            <div class="field"><label>Action</label><input type="text" value="\${escHtml(btn.action)}" oninput="buttons[\${i}].action=this.value"></div>
          </div>
          <div class="btn-row">
            <button class="ghost" onclick="moveButton(\${i},-1)" \${i===0?'disabled':''}>↑</button>
            <button class="ghost" onclick="moveButton(\${i},1)" \${i===buttons.length-1?'disabled':''}>↓</button>
            <button class="danger" onclick="deleteButton(\${i})">Delete</button>
          </div>
        \`;
        list.appendChild(card);
      });
    }

    function moveButton(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= buttons.length) return;
      [buttons[i], buttons[j]] = [buttons[j], buttons[i]];
      renderButtons();
    }

    function deleteButton(i) {
      buttons.splice(i, 1);
      renderButtons();
    }

    function addButton() {
      const name = document.getElementById('new-name').value.trim();
      const type = document.getElementById('new-type').value;
      const icon = document.getElementById('new-icon').value.trim();
      const action = document.getElementById('new-action').value.trim();
      if (!name || !icon || !action) { showToast('Fill in all fields', false); return; }
      buttons.push({ name, type, icon, action });
      document.getElementById('new-name').value = '';
      document.getElementById('new-icon').value = '';
      document.getElementById('new-action').value = '';
      renderButtons();
    }

    async function saveConfig() {
      const rows = parseInt(document.getElementById('grid-rows').value, 10);
      const cols = parseInt(document.getElementById('grid-cols').value, 10);
      if (isNaN(rows) || isNaN(cols)) { showToast('Rows and cols must be numbers', false); return; }
      const config = { grid: { rows, cols }, buttons };
      try {
        const res = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showToast(err.error || 'Save failed', false);
        } else {
          showToast('Saved!', true);
        }
      } catch {
        showToast('Network error', false);
      }
    }

    function showToast(msg, ok) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.className = 'toast ' + (ok ? 'ok' : 'err');
      setTimeout(() => { toast.textContent = ''; toast.className = 'toast'; }, 3000);
    }

    loadConfig();
  </script>
</body>
</html>`);
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
    <p style="margin-top:1.5rem;border-top:1px solid #2a2a3e;padding-top:1rem"><a href="/admin" style="color:#818cf8">⚙ Admin — edit config</a></p>
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

const PORT_FILE = `${
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")
}/.panna-cotta.port`;

async function isPortFree(p: number): Promise<boolean> {
  try {
    const listener = Deno.listen({ port: p });
    listener.close();
    return true;
  } catch {
    return false;
  }
}

async function resolvePort(): Promise<number> {
  try {
    const saved = parseInt(await Deno.readTextFile(PORT_FILE));
    if (saved >= 30000 && saved < 40000 && await isPortFree(saved)) {
      return saved;
    }
  } catch {
    // no saved port yet
  }

  for (let p = 30000; p < 40000; p++) {
    if (await isPortFree(p)) {
      await Deno.writeTextFile(PORT_FILE, String(p));
      return p;
    }
  }

  throw new Error("No free port found in range 30000-39999");
}

const port = await resolvePort();
console.log(`Panna Cotta running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
