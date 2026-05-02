import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";
import {
  executeCommand,
  getSystemStatus,
  openApplication,
  openUrl,
} from "./services/system.ts";
import {
  activateProfile,
  configDir,
  configSchema,
  createProfile,
  defaultConfig,
  deleteProfile,
  listProfiles,
  renameProfile,
  saveStreamDeckConfig,
  useStreamDeckConfig,
} from "./services/config.ts";
import { CURRENT_VERSION, getVersionInfo } from "./services/version.ts";

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
app.get("/api/version", async (c) => c.json(await getVersionInfo()));

app.get("/api/check-update", async (c) => {
  try {
    const res = await fetch(
      "https://api.github.com/repos/mwong-io/panna-cotta/releases/latest",
      { headers: { "User-Agent": "panna-cotta-server" } },
    );
    if (!res.ok) return c.json({ error: "GitHub API error" }, 502);
    const data = await res.json() as {
      tag_name: string;
      name: string;
      html_url: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    };
    return c.json({
      version: data.tag_name,
      name: data.name,
      url: data.html_url,
      assets: data.assets.map((a) => ({
        name: a.name,
        url: a.browser_download_url,
      })),
    });
  } catch (err) {
    return c.json(
      { error: `Failed to check for updates: ${String(err)}` },
      500,
    );
  }
});

// --- Profile routes ---

app.get("/api/profiles", async (c) => {
  return c.json(await listProfiles());
});

app.post("/api/profiles", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const name = (body as { name?: string })?.name?.trim();
  if (!name) return c.json({ error: "name required" }, 400);
  try {
    await createProfile(name);
    await activateProfile(name);
    return c.json({ ok: true, name });
  } catch (err) {
    return c.json({ error: String(err) }, 400);
  }
});

app.post("/api/profiles/:name/activate", async (c) => {
  const name = decodeURIComponent(c.req.param("name"));
  try {
    await activateProfile(name);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 404);
  }
});

app.patch("/api/profiles/:name", async (c) => {
  const oldName = decodeURIComponent(c.req.param("name"));
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const newName = (body as { newName?: string })?.newName?.trim();
  if (!newName) return c.json({ error: "newName required" }, 400);
  try {
    await renameProfile(oldName, newName);
    return c.json({ ok: true, name: newName });
  } catch (err) {
    return c.json({ error: String(err) }, 400);
  }
});

app.delete("/api/profiles/:name", async (c) => {
  const name = decodeURIComponent(c.req.param("name"));
  try {
    await deleteProfile(name);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 400);
  }
});

app.post("/api/open-config-folder", async (c) => {
  const dir = configDir();
  try {
    const os = Deno.build.os;
    const cmd = os === "darwin"
      ? ["open", dir]
      : os === "windows"
      ? ["explorer", dir]
      : ["xdg-open", dir];
    const proc = new Deno.Command(cmd[0], { args: cmd.slice(1) });
    await proc.output();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// --- Config routes ---

app.get("/api/config", async (c) => {
  const config = await useStreamDeckConfig();
  c.header("Cache-Control", "no-store");
  return c.json(config);
});

app.get("/api/config/default", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(defaultConfig);
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
    return c.json(
      { error: "Invalid config", details: parsed.error.flatten() },
      400,
    );
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
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#1c1c1e;color:#f0f0f0;height:100vh;display:flex;flex-direction:column;overflow:hidden}

    /* Top bar */
    .topbar{display:flex;align-items:center;gap:0.6rem;padding:0.55rem 1rem;background:#141416;border-bottom:1px solid #3a3a3c;flex-shrink:0}
    .back-link{color:#666;text-decoration:none;font-size:0.9rem;padding:0.25rem 0.4rem;border-radius:0.3rem}
    .back-link:hover{color:#f0f0f0;background:#2a2a2c}
    .app-title{font-size:0.9rem;font-weight:600;white-space:nowrap}
    .profile-section{display:flex;align-items:center;gap:0.3rem;margin-left:0.5rem}
    .profile-select{background:#2a2a2c;border:1px solid #3a3a3c;color:#f0f0f0;padding:0.28rem 0.5rem;border-radius:0.35rem;font-size:0.8rem;cursor:pointer;max-width:120px}
    .icon-btn{background:#2a2a2c;border:1px solid #3a3a3c;color:#aaa;padding:0.28rem 0.55rem;border-radius:0.35rem;cursor:pointer;font-size:0.75rem;line-height:1}
    .icon-btn:hover{background:#3a3a3c;color:#f0f0f0}
    .spacer{flex:1}
    .btn{background:#4f46e5;color:#fff;border:none;padding:0.35rem 0.85rem;border-radius:0.35rem;cursor:pointer;font-size:0.8rem;white-space:nowrap}
    .btn:hover{background:#6366f1}
    .btn.secondary{background:#2a2a2c;border:1px solid #3a3a3c;color:#ccc}
    .btn.secondary:hover{background:#3a3a3c;color:#f0f0f0}
    .btn.danger{background:transparent;color:#f87171;border:1px solid #3a3a3c}
    .btn.danger:hover{background:#2e1a1a;border-color:#f87171}

    /* Layout */
    .main{display:flex;flex:1;overflow:hidden}

    /* Left panel */
    .left-panel{flex:1;display:flex;flex-direction:column;overflow-y:auto;padding:0.875rem;gap:0.75rem;min-width:0}
    .section-label{font-size:0.7rem;color:#666;text-transform:uppercase;letter-spacing:0.07em;font-weight:600}

    /* Grid settings */
    .grid-settings{display:flex;align-items:center;gap:0.6rem;font-size:0.8rem;color:#888}
    .grid-settings input{background:#2a2a2c;border:1px solid #3a3a3c;color:#f0f0f0;padding:0.25rem 0.4rem;border-radius:0.3rem;width:3.2rem;font-size:0.8rem;text-align:center}

    /* Grid preview */
    .grid-preview{display:grid;gap:0.45rem;background:#252527;padding:0.875rem;border-radius:0.6rem;width:fit-content}
    .grid-cell{width:72px;height:72px;background:#3a3a3c;border-radius:0.5rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;border:2px solid transparent;transition:border-color 0.1s,background 0.1s;overflow:hidden;padding:4px;position:relative}
    .grid-cell:hover{background:#464648}
    .grid-cell.selected{border-color:#4f46e5;background:#1e1a3a}
    .grid-cell.empty{opacity:0.35}
    .grid-cell.empty:hover{opacity:0.6}
    .cell-icon{font-size:1.5rem;line-height:1}
    .cell-label{font-size:0.58rem;color:#ccc;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:66px}
    .cell-idx{position:absolute;top:3px;right:4px;font-size:0.5rem;color:#555}

    /* Divider */
    .divider{height:1px;background:#3a3a3c;flex-shrink:0}

    /* Editor panel */
    .editor-panel{background:#252527;border-radius:0.6rem;padding:0.75rem}
    .editor-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:0.6rem}
    .editor-title{font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:0.06em;font-weight:600}
    .editor-fields{display:grid;grid-template-columns:1fr 1fr;gap:0.5rem}
    .field{display:flex;flex-direction:column;gap:0.2rem}
    .field label{font-size:0.7rem;color:#777}
    .field input,.field select{background:#1c1c1e;border:1px solid #3a3a3c;color:#f0f0f0;padding:0.32rem 0.55rem;border-radius:0.35rem;font-size:0.82rem;width:100%}
    .field input:focus,.field select:focus{outline:1px solid #4f46e5;border-color:#4f46e5}
    .field.full{grid-column:1/-1}
    .editor-actions{display:flex;gap:0.4rem;margin-top:0.55rem}

    /* Right panel */
    .right-panel{width:220px;border-left:1px solid #3a3a3c;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0}
    .right-header{padding:0.65rem 0.65rem 0.5rem;flex-shrink:0;border-bottom:1px solid #3a3a3c}
    .search-input{width:100%;background:#2a2a2c;border:1px solid #3a3a3c;color:#f0f0f0;padding:0.35rem 0.65rem;border-radius:0.35rem;font-size:0.8rem}
    .search-input::placeholder{color:#555}
    .search-input:focus{outline:1px solid #4f46e5;border-color:#4f46e5}
    .actions-list{flex:1;overflow-y:auto;padding:0.4rem 0.4rem 0.75rem}
    .action-group{margin-top:0.35rem}
    .action-group-header{display:flex;align-items:center;gap:0.35rem;font-size:0.68rem;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.07em;padding:0.35rem 0.4rem 0.2rem}
    .action-group-items{display:flex;flex-direction:column;gap:1px}
    .action-item{display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.6rem;border-radius:0.35rem;font-size:0.8rem;color:#bbb;cursor:pointer}
    .action-item:hover{background:#2a2a2c;color:#f0f0f0}
    .action-item-icon{width:1.1rem;text-align:center;font-size:0.9rem;flex-shrink:0}

    /* Toast */
    .toast-bar{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#2a2a2c;border:1px solid #3a3a3c;padding:0.45rem 1.1rem;border-radius:2rem;font-size:0.82rem;opacity:0;transition:opacity 0.2s;pointer-events:none;white-space:nowrap}
    .toast-bar.show{opacity:1}
    .toast-bar.ok{border-color:#4ade80;color:#4ade80}
    .toast-bar.err{border-color:#f87171;color:#f87171}
  </style>
</head>
<body>
  <div class="topbar">
    <a href="/" class="back-link">←</a>
    <span class="app-title">Panna Cotta</span>
    <div class="profile-section">
      <select class="profile-select" id="profile-select" onchange="switchProfile(this.value)"></select>
      <button class="icon-btn" onclick="newProfile()" title="New profile">+</button>
      <button class="icon-btn" onclick="renameCurrentProfile()" title="Rename profile">✎</button>
      <button class="icon-btn" onclick="deleteCurrentProfile()" title="Delete profile">×</button>
    </div>
    <div class="spacer"></div>
    <button class="btn secondary" onclick="openConfigFolder()">📂 Config Folder</button>
    <button class="btn secondary" onclick="resetToDefault()">Reset</button>
    <button class="btn" onclick="saveConfig()">Save</button>
  </div>

  <div class="main">
    <div class="left-panel">
      <div class="grid-settings">
        <span class="section-label">Grid</span>
        <span style="color:#666">Rows</span>
        <input type="number" id="grid-rows" min="1" max="10" value="2" oninput="renderGrid()">
        <span style="color:#666">Cols</span>
        <input type="number" id="grid-cols" min="1" max="10" value="3" oninput="renderGrid()">
      </div>
      <div id="grid-preview" class="grid-preview"></div>
      <div class="divider"></div>
      <div class="editor-panel">
        <div class="editor-header">
          <span class="editor-title" id="editor-title">Add Button</span>
        </div>
        <div class="editor-fields">
          <div class="field"><label>Name</label><input type="text" id="btn-name" placeholder="GitHub"></div>
          <div class="field"><label>Type</label>
            <select id="btn-type">
              <option value="browser">browser</option>
              <option value="system">system</option>
            </select>
          </div>
          <div class="field"><label>Icon (Lucide name)</label><input type="text" id="btn-icon" placeholder="github"></div>
          <div class="field full"><label>Action (URL or app name)</label><input type="text" id="btn-action" placeholder="https://github.com"></div>
        </div>
        <div class="editor-actions">
          <button class="btn" id="editor-save-btn" onclick="editorSave()">Add</button>
          <button class="btn secondary" onclick="editorClear()">Clear</button>
          <button class="btn danger" id="editor-delete-btn" onclick="editorDelete()" style="display:none">Delete</button>
        </div>
      </div>
    </div>

    <div class="right-panel">
      <div class="right-header">
        <input class="search-input" id="search" type="search" placeholder="Search actions…" oninput="filterActions(this.value)">
      </div>
      <div class="actions-list" id="actions-list"></div>
    </div>
  </div>

  <div class="toast-bar" id="toast-bar"></div>

  <script>
    let buttons = [];
    let selectedIndex = -1;
    let profiles = [];
    let activeProfile = 'Default';

    const ACTION_GROUPS = [
      { name: 'Browser', icon: '🌐', items: [
        { name: 'Open URL', icon: '🔗', type: 'browser', action: 'https://', iconName: 'link' },
      ]},
      { name: 'System', icon: '⚙️', items: [
        { name: 'Open App', icon: '🖥', type: 'system', action: '', iconName: 'terminal' },
        { name: 'Volume Up', icon: '🔊', type: 'system', action: 'volume-up', iconName: 'volume-2' },
        { name: 'Volume Down', icon: '🔉', type: 'system', action: 'volume-down', iconName: 'volume-1' },
        { name: 'Mute Toggle', icon: '🔇', type: 'system', action: 'volume-mute', iconName: 'volume-x' },
        { name: 'Brightness Up', icon: '☀️', type: 'system', action: 'brightness-up', iconName: 'sun' },
        { name: 'Brightness Down', icon: '🌙', type: 'system', action: 'brightness-down', iconName: 'moon' },
        { name: 'Sleep', icon: '💤', type: 'system', action: 'sleep', iconName: 'power' },
        { name: 'Lock Screen', icon: '🔒', type: 'system', action: 'lock', iconName: 'lock' },
      ]},
    ];

    const ICON_MAP = {
      github:'⬡',link:'🔗',globe:'🌐',chrome:'🌐',terminal:'🖥',
      'volume-2':'🔊','volume-1':'🔉','volume-x':'🔇',sun:'☀️',moon:'🌙',
      power:'⏻',lock:'🔒',calculator:'🧮',youtube:'▶',twitch:'📺',
      reddit:'🔴',mail:'✉️',spotify:'♫',discord:'💬',code:'</>',
      'message-square':'💬',
    };

    function iconEmoji(name) {
      return ICON_MAP[name] || (name ? name.slice(0,2).toUpperCase() : '?');
    }

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    async function init() {
      await loadProfiles();
      await loadConfig();
      renderActionGroups(ACTION_GROUPS);
    }

    async function loadProfiles() {
      const res = await fetch('/api/profiles');
      if (!res.ok) return;
      profiles = await res.json();
      const active = profiles.find(p => p.isActive);
      activeProfile = active ? active.name : profiles[0]?.name ?? 'Default';
      renderProfileSelect();
    }

    function renderProfileSelect() {
      const sel = document.getElementById('profile-select');
      sel.innerHTML = profiles.map(p =>
        \`<option value="\${escHtml(p.name)}" \${p.isActive ? 'selected' : ''}>\${escHtml(p.name)}</option>\`
      ).join('');
    }

    async function switchProfile(name) {
      const res = await fetch('/api/profiles/' + encodeURIComponent(name) + '/activate', { method: 'POST' });
      if (!res.ok) { toast('Failed to switch profile', false); return; }
      activeProfile = name;
      profiles = profiles.map(p => ({ ...p, isActive: p.name === name }));
      await loadConfig();
    }

    async function newProfile() {
      const name = prompt('New profile name:');
      if (!name || !name.trim()) return;
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      if (!res.ok) { toast((await res.json().catch(()=>({}))).error || 'Could not create profile', false); return; }
      await loadProfiles();
      await loadConfig();
    }

    async function renameCurrentProfile() {
      const newName = prompt('Rename "' + activeProfile + '" to:');
      if (!newName || !newName.trim() || newName.trim() === activeProfile) return;
      const res = await fetch('/api/profiles/' + encodeURIComponent(activeProfile), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: newName.trim() })
      });
      if (!res.ok) { toast('Could not rename', false); return; }
      activeProfile = newName.trim();
      await loadProfiles();
    }

    async function deleteCurrentProfile() {
      if (!confirm('Delete profile "' + activeProfile + '"? This cannot be undone.')) return;
      const res = await fetch('/api/profiles/' + encodeURIComponent(activeProfile), { method: 'DELETE' });
      if (!res.ok) { toast((await res.json().catch(()=>({}))).error || 'Could not delete', false); return; }
      await loadProfiles();
      await loadConfig();
    }

    async function loadConfig() {
      const res = await fetch('/api/config');
      if (!res.ok) { toast('Failed to load config', false); return; }
      const config = await res.json();
      document.getElementById('grid-rows').value = config.grid.rows;
      document.getElementById('grid-cols').value = config.grid.cols;
      buttons = config.buttons || [];
      selectedIndex = -1;
      editorClear();
      renderGrid();
    }

    function renderGrid() {
      const rows = Math.max(1, parseInt(document.getElementById('grid-rows').value) || 2);
      const cols = Math.max(1, parseInt(document.getElementById('grid-cols').value) || 3);
      const preview = document.getElementById('grid-preview');
      preview.style.gridTemplateColumns = 'repeat(' + cols + ', 72px)';
      const total = rows * cols;
      preview.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const btn = buttons[i];
        const cell = document.createElement('div');
        cell.className = 'grid-cell' + (btn ? '' : ' empty') + (selectedIndex === i ? ' selected' : '');
        cell.onclick = () => selectCell(i);
        if (btn) {
          cell.innerHTML = '<div class="cell-icon">' + iconEmoji(btn.icon) + '</div><div class="cell-label">' + escHtml(btn.name) + '</div>';
        } else {
          cell.innerHTML = '<div class="cell-icon" style="opacity:0.4;font-size:1.1rem">+</div>';
        }
        cell.innerHTML += '<div class="cell-idx">' + (i + 1) + '</div>';
        preview.appendChild(cell);
      }
    }

    function selectCell(i) {
      const btn = buttons[i];
      if (btn) {
        selectedIndex = i;
        document.getElementById('btn-name').value = btn.name;
        document.getElementById('btn-type').value = btn.type;
        document.getElementById('btn-icon').value = btn.icon;
        document.getElementById('btn-action').value = btn.action;
        document.getElementById('editor-title').textContent = 'Edit: ' + btn.name;
        document.getElementById('editor-save-btn').textContent = 'Update';
        document.getElementById('editor-delete-btn').style.display = '';
      } else {
        selectedIndex = i;
        document.getElementById('btn-name').value = '';
        document.getElementById('btn-type').value = 'browser';
        document.getElementById('btn-icon').value = '';
        document.getElementById('btn-action').value = '';
        document.getElementById('editor-title').textContent = 'Add to slot ' + (i + 1);
        document.getElementById('editor-save-btn').textContent = 'Add';
        document.getElementById('editor-delete-btn').style.display = 'none';
        document.getElementById('btn-name').focus();
      }
      renderGrid();
    }

    function editorClear() {
      selectedIndex = -1;
      document.getElementById('btn-name').value = '';
      document.getElementById('btn-type').value = 'browser';
      document.getElementById('btn-icon').value = '';
      document.getElementById('btn-action').value = '';
      document.getElementById('editor-title').textContent = 'Add Button';
      document.getElementById('editor-save-btn').textContent = 'Add';
      document.getElementById('editor-delete-btn').style.display = 'none';
      renderGrid();
    }

    function editorSave() {
      const name = document.getElementById('btn-name').value.trim();
      const type = document.getElementById('btn-type').value;
      const icon = document.getElementById('btn-icon').value.trim();
      const action = document.getElementById('btn-action').value.trim();
      if (!name || !icon || !action) { toast('Fill in all fields', false); return; }
      const btn = { name, type, icon, action };
      if (selectedIndex >= 0 && buttons[selectedIndex]) {
        buttons[selectedIndex] = btn;
      } else if (selectedIndex >= 0) {
        while (buttons.length < selectedIndex) buttons.push(null);
        buttons[selectedIndex] = btn;
        buttons = buttons.filter(Boolean);
      } else {
        buttons.push(btn);
      }
      editorClear();
    }

    function editorDelete() {
      if (selectedIndex < 0 || !buttons[selectedIndex]) return;
      buttons.splice(selectedIndex, 1);
      editorClear();
    }

    async function saveConfig() {
      const rows = parseInt(document.getElementById('grid-rows').value, 10);
      const cols = parseInt(document.getElementById('grid-cols').value, 10);
      if (isNaN(rows) || isNaN(cols)) { toast('Invalid grid dimensions', false); return; }
      const config = { grid: { rows, cols }, buttons: buttons.filter(Boolean) };
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        toast((await res.json().catch(()=>({}))).error || 'Save failed', false);
      } else {
        toast('Saved!', true);
        await loadConfig();
      }
    }

    async function resetToDefault() {
      if (!confirm('Reset buttons and grid to defaults? This overwrites the current profile.')) return;
      const res = await fetch('/api/config/default');
      if (!res.ok) { toast('Failed to load defaults', false); return; }
      const config = await res.json();
      document.getElementById('grid-rows').value = config.grid.rows;
      document.getElementById('grid-cols').value = config.grid.cols;
      buttons = config.buttons || [];
      editorClear();
      toast('Defaults loaded — click Save to apply', true);
    }

    async function openConfigFolder() {
      const res = await fetch('/api/open-config-folder', { method: 'POST' });
      if (!res.ok) toast('Could not open folder', false);
    }

    function renderActionGroups(groups, filter) {
      const list = document.getElementById('actions-list');
      list.innerHTML = '';
      const q = (filter || '').toLowerCase();
      for (const group of groups) {
        const items = q ? group.items.filter(i => i.name.toLowerCase().includes(q)) : group.items;
        if (!items.length) continue;
        const groupEl = document.createElement('div');
        groupEl.className = 'action-group';
        const hdr = document.createElement('div');
        hdr.className = 'action-group-header';
        hdr.textContent = group.icon + ' ' + group.name;
        groupEl.appendChild(hdr);
        const itemsEl = document.createElement('div');
        itemsEl.className = 'action-group-items';
        for (const item of items) {
          const el = document.createElement('div');
          el.className = 'action-item';
          el.innerHTML = '<span class="action-item-icon">' + item.icon + '</span>' + escHtml(item.name);
          el.onclick = () => useTemplate(item);
          itemsEl.appendChild(el);
        }
        groupEl.appendChild(itemsEl);
        list.appendChild(groupEl);
      }
    }

    function filterActions(q) { renderActionGroups(ACTION_GROUPS, q); }

    function useTemplate(t) {
      document.getElementById('btn-name').value = t.name;
      document.getElementById('btn-type').value = t.type;
      document.getElementById('btn-icon').value = t.iconName;
      document.getElementById('btn-action').value = t.action;
      if (selectedIndex < 0) {
        document.getElementById('editor-title').textContent = 'Add Button';
        document.getElementById('editor-save-btn').textContent = 'Add';
      }
      document.getElementById('btn-name').focus();
    }

    function toast(msg, ok) {
      const el = document.getElementById('toast-bar');
      el.textContent = msg;
      el.className = 'toast-bar show ' + (ok ? 'ok' : 'err');
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.className = 'toast-bar'; }, 2500);
    }

    init();
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
    .card { background: #1a1a2e; padding: 2rem; border-radius: 1rem; text-align: center; max-width: 400px; width: 100%; box-sizing: border-box; }
    h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
    p { color: #aaa; line-height: 1.5; }
    img { margin: 1.5rem 0; border-radius: 0.5rem; }
    code { background: #2a2a3e; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.9rem; }
    a { color: #818cf8; }
    .btn-check-update { display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 1rem; padding: 0.5rem 1.1rem; background: #818cf8; color: #fff; border: none; border-radius: 0.5rem; font-size: 0.9rem; cursor: pointer; transition: background 0.15s; }
    .btn-check-update:hover { background: #6366f1; }
    .btn-check-update:disabled { background: #4a4a6a; cursor: default; }
    .update-banner { margin-top: 1rem; padding: 1rem; border-radius: 0.5rem; background: #0f2e1a; border: 1px solid #22c55e; text-align: left; font-size: 0.88rem; }
    .update-banner.error { background: #2e0f0f; border-color: #ef4444; }
    .update-banner h3 { margin: 0 0 0.5rem; color: #22c55e; font-size: 0.95rem; }
    .update-banner.error h3 { color: #ef4444; }
    .asset-list { list-style: none; margin: 0.5rem 0 0; padding: 0; }
    .asset-list li { margin: 0.3rem 0; }
    .asset-list a { color: #818cf8; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Panna Cotta</h1>
    <p>Scan the QR code with your phone to open the Stream Deck:</p>
    <img src="${qrCodeUrl}" alt="QR Code" width="200" height="200">
    <p>Or open: <a href="${appUrl}"><code>${appUrl}</code></a></p>
    <p style="margin-top:1.5rem;border-top:1px solid #2a2a3e;padding-top:1rem"><a href="/admin" style="color:#818cf8">⚙ Admin — edit config</a></p>
    <p style="margin-top:0.5rem;font-size:0.8rem;color:#666">v${CURRENT_VERSION}</p>
    <button class="btn-check-update" id="checkUpdateBtn" onclick="checkUpdate()">↑ Check for updates</button>
    <div id="updateResult" style="display:none"></div>
  </div>
  <script>
    async function checkUpdate() {
      const btn = document.getElementById('checkUpdateBtn');
      const result = document.getElementById('updateResult');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      result.style.display = 'none';
      try {
        const res = await fetch('/api/check-update');
        const data = await res.json();
        if (!res.ok || data.error) {
          result.innerHTML = '<div class="update-banner error"><h3>Could not check for updates</h3><p>' + (data.error ?? 'Unknown error') + '</p></div>';
        } else {
          const assets = data.assets.length
            ? '<ul class="asset-list">' + data.assets.map(a => '<li><a href="' + a.url + '" target="_blank" rel="noopener">⬇ ' + a.name + '</a></li>').join('') + '</ul>'
            : '<p>No binary assets found. <a href="' + data.url + '" target="_blank" rel="noopener">View release on GitHub</a></p>';
          result.innerHTML = '<div class="update-banner"><h3>Latest release: ' + data.version + '</h3><p>' + (data.name ?? '') + '</p>' + assets + '</div>';
        }
      } catch (e) {
        result.innerHTML = '<div class="update-banner error"><h3>Network error</h3><p>' + e.message + '</p></div>';
      }
      result.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '↑ Check for updates';
    }
  </script>
</body>
</html>`);
});

// --- Static frontend files ---

const frontendPath = fromFileUrl(new URL("../frontend", import.meta.url));

app.get("/apps", (c) => c.redirect("/apps/"));

app.get("/apps/*", (c) => {
  return serveDir(c.req.raw, { fsRoot: frontendPath, urlRoot: "apps" });
});

// --- Start server ---

const PORT_FILE = `${
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")
}/.panna-cotta.port`;

function isPortFree(p: number): boolean {
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
    if (saved >= 30000 && saved < 40000 && isPortFree(saved)) {
      return saved;
    }
  } catch {
    // no saved port yet
  }

  for (let p = 30000; p < 40000; p++) {
    if (isPortFree(p)) {
      await Deno.writeTextFile(PORT_FILE, String(p));
      return p;
    }
  }

  throw new Error("No free port found in range 30000-39999");
}

const port = await resolvePort();
console.log(`Panna Cotta running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
