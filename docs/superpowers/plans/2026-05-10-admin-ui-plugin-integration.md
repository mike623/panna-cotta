# Admin UI: Plugin-Aware Action Sidebar & Property Inspector (Plan 4 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the admin Svelte UI to the live plugin system — dynamic action list from `/api/plugins`, plugin status badges, and a Property Inspector iframe for third-party plugin actions.

**Architecture:** A new `list_plugins_cmd` Tauri command exposes plugin+action metadata (including optional `PropertyInspectorPath`) to the frontend. `ActionSidebar` replaces its hardcoded action list with live plugin data. `ButtonEditor` detects whether a selected button's action belongs to a third-party plugin and either renders the PI iframe or a generic JSON settings editor; built-in `com.pannacotta.*` actions keep their existing hardcoded forms.

**Tech Stack:** Rust/Tauri (commands, serde), Svelte 4, TypeScript, Axum (existing `/pi/:uuid/*path` route already implemented in Plans 1–3).

---

## File Map

| File | Change |
|---|---|
| `src-tauri/src/plugin/manifest.rs` | Add optional `property_inspector_path` to `Action` |
| `src-tauri/src/server/routes.rs` | Include `pi_path` in `list_plugins_handler` JSON |
| `src-tauri/src/commands/plugins.rs` | New — `list_plugins_cmd` Tauri command |
| `src-tauri/src/commands/mod.rs` | Add `pub mod plugins;` |
| `src-tauri/src/app.rs` | Register `list_plugins_cmd` in invoke_handler |
| `src/lib/types.ts` | Add `ActionInfo`, `PluginInfo` types |
| `src/lib/invoke.ts` | Add `listPlugins()` wrapper |
| `src/components/ActionSidebar.svelte` | Dynamic plugin-sourced action list + status badges |
| `src/components/ButtonEditor.svelte` | Plugin-aware editor: PI iframe / JSON editor / built-in form |
| `src/App.svelte` | Fetch plugins, pass to ButtonEditor |

---

### Task 1: Add `PropertyInspectorPath` to manifest `Action` struct

**Files:**
- Modify: `packages/desktop/src-tauri/src/plugin/manifest.rs`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)]` block in `manifest.rs`:

```rust
#[test]
fn parse_action_with_pi_path() {
    let json = r#"{
        "UUID": "com.example.plugin",
        "Name": "Example",
        "SDKVersion": 2,
        "CodePath": "bin/plugin.js",
        "Actions": [{
            "UUID": "com.example.plugin.act",
            "Name": "Act",
            "PropertyInspectorPath": "pi/index.html"
        }]
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    assert_eq!(m.actions[0].property_inspector_path.as_deref(), Some("pi/index.html"));
}

#[test]
fn parse_action_without_pi_path() {
    let json = r#"{
        "UUID": "com.example.plugin",
        "Name": "Example",
        "SDKVersion": 2,
        "CodePath": "bin/plugin.js",
        "Actions": [{"UUID": "com.example.plugin.act", "Name": "Act"}]
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    assert!(m.actions[0].property_inspector_path.is_none());
}
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd packages/desktop/src-tauri && cargo test manifest::tests::parse_action_with_pi_path 2>&1 | tail -5
```

Expected: `error[E0609]: no field 'property_inspector_path'`

- [ ] **Step 3: Add field to `Action` struct**

In `manifest.rs`, update the `Action` struct:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct Action {
    #[serde(rename = "UUID")]
    pub uuid: String,
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "PropertyInspectorPath", default)]
    pub property_inspector_path: Option<String>,
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd packages/desktop/src-tauri && cargo test manifest::tests 2>&1 | tail -10
```

Expected: all manifest tests pass.

- [ ] **Step 5: Update `list_plugins_handler` in routes.rs to expose pi_path**

Find the `actions` mapping inside `list_plugins_handler` (around line 419):

```rust
// Before:
actions: manifest.actions.iter().map(|a| (a.uuid.clone(), a.name.clone())).collect(),
```

Change the `PluginSnapshot` actions field type and the final JSON mapping:

```rust
// In the PluginSnapshot struct definition (local, inside list_plugins_handler):
actions: Vec<(String, String, Option<String>)>, // (uuid, name, pi_path)
```

```rust
// In the .map() that builds PluginSnapshot:
actions: manifest.actions.iter().map(|a| (a.uuid.clone(), a.name.clone(), a.property_inspector_path.clone())).collect(),
```

```rust
// In the final JSON serialization .map():
"actions": s.actions.iter().map(|(u, n, pi)| serde_json::json!({
    "uuid": u,
    "name": n,
    "piPath": pi,
})).collect::<Vec<_>>(),
```

- [ ] **Step 6: Run full test suite**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/admin-ui-plugin-integration
git add packages/desktop/src-tauri/src/plugin/manifest.rs \
        packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat: add PropertyInspectorPath to manifest Action; expose pi_path in /api/plugins"
```

---

### Task 2: Add `list_plugins_cmd` Tauri command

**Files:**
- Create: `packages/desktop/src-tauri/src/commands/plugins.rs`
- Modify: `packages/desktop/src-tauri/src/commands/mod.rs`
- Modify: `packages/desktop/src-tauri/src/app.rs`

- [ ] **Step 1: Create `commands/plugins.rs`**

```rust
use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use crate::server::state::AppState;

#[derive(Serialize)]
pub struct ActionDto {
    pub uuid: String,
    pub name: String,
    pub pi_path: Option<String>,
}

#[derive(Serialize)]
pub struct PluginDto {
    pub uuid: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub status: String,
    pub actions: Vec<ActionDto>,
}

#[tauri::command]
pub async fn list_plugins_cmd(state: State<'_, Arc<AppState>>) -> Result<Vec<PluginDto>, String> {
    let host = state.plugin_host.lock().await;
    let plugins = host.manifests.iter().map(|(uuid, manifest)| {
        let status = host.plugins.get(uuid)
            .map(|ps| match &ps.status {
                crate::plugin::PluginStatus::Running    => "running",
                crate::plugin::PluginStatus::Starting   => "starting",
                crate::plugin::PluginStatus::Stopped    => "stopped",
                crate::plugin::PluginStatus::Errored(_) => "errored",
            })
            .unwrap_or("not_spawned")
            .to_string();
        PluginDto {
            uuid: uuid.clone(),
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            author: manifest.author.clone(),
            description: manifest.description.clone(),
            status,
            actions: manifest.actions.iter().map(|a| ActionDto {
                uuid: a.uuid.clone(),
                name: a.name.clone(),
                pi_path: a.property_inspector_path.clone(),
            }).collect(),
        }
    }).collect();
    Ok(plugins)
}
```

- [ ] **Step 2: Register module in `commands/mod.rs`**

Add to the existing list:

```rust
pub mod plugins;
```

- [ ] **Step 3: Register command in `app.rs` invoke_handler**

Find the `tauri::generate_handler![` block in `app.rs` and append:

```rust
crate::commands::plugins::list_plugins_cmd,
```

- [ ] **Step 4: Verify it compiles**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/commands/plugins.rs \
        packages/desktop/src-tauri/src/commands/mod.rs \
        packages/desktop/src-tauri/src/app.rs
git commit -m "feat: add list_plugins_cmd Tauri command"
```

---

### Task 3: Frontend types + invoke wrapper

**Files:**
- Modify: `packages/desktop/src/lib/types.ts`
- Modify: `packages/desktop/src/lib/invoke.ts`

- [ ] **Step 1: Add plugin types to `types.ts`**

Append to the end of `types.ts`:

```typescript
export interface ActionInfo {
  uuid: string
  name: string
  piPath: string | null
}

export interface PluginInfo {
  uuid: string
  name: string
  version: string
  author: string
  description: string
  status: 'running' | 'starting' | 'stopped' | 'errored' | 'not_spawned'
  actions: ActionInfo[]
}
```

- [ ] **Step 2: Add `listPlugins` to `invoke.ts`**

Add the import and export at the top of the existing imports block:

```typescript
import type { StreamDeckConfig, Profile, ServerInfo, PluginInfo } from './types'
```

Append to `invoke.ts`:

```typescript
export const listPlugins = () =>
  invoke<PluginInfo[]>('list_plugins_cmd')
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/desktop && npm run build 2>&1 | grep -i "error" | head -10
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/lib/types.ts \
        packages/desktop/src/lib/invoke.ts
git commit -m "feat: add PluginInfo types and listPlugins invoke wrapper"
```

---

### Task 4: Dynamic ActionSidebar

**Files:**
- Modify: `packages/desktop/src/components/ActionSidebar.svelte`

The sidebar replaces its hardcoded `ACTION_GROUPS` constant with a live fetch from `listPlugins()`. Built-in plugins (`com.pannacotta.browser`, `com.pannacotta.system`) appear as normal groups since they are real registered plugins.

Status badge emoji:
- `running` → `🟢`
- `starting` → `🟡`
- `stopped` / `not_spawned` → `⚫`
- `errored` → `🔴`

- [ ] **Step 1: Rewrite `ActionSidebar.svelte`**

Replace the entire file contents:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { createEventDispatcher } from 'svelte'
  import { listPlugins } from '../lib/invoke'
  import type { Button, PluginInfo } from '../lib/types'

  const dispatch = createEventDispatcher<{ use: Partial<Button> }>()

  let query = ''
  let plugins: PluginInfo[] = []
  let loadError = ''

  onMount(async () => {
    try {
      plugins = await listPlugins()
    } catch (e) {
      loadError = String(e)
    }
  })

  function statusBadge(status: PluginInfo['status']): string {
    switch (status) {
      case 'running':    return '🟢'
      case 'starting':   return '🟡'
      case 'errored':    return '🔴'
      default:           return '⚫'
    }
  }

  $: filtered = plugins.map(p => ({
    ...p,
    actions: query
      ? p.actions.filter(a => a.name.toLowerCase().includes(query.toLowerCase()))
      : p.actions,
  })).filter(p => p.actions.length > 0)
</script>

<div class="right-panel">
  <div class="right-header">
    <input class="search-input" type="search" placeholder="Search actions…" bind:value={query} />
  </div>
  <div class="actions-list">
    {#if loadError}
      <p class="load-error">{loadError}</p>
    {:else if plugins.length === 0}
      <p class="empty">No plugins loaded</p>
    {:else}
      {#each filtered as plugin}
        <div class="action-group">
          <div class="action-group-header">
            <span class="status-dot">{statusBadge(plugin.status)}</span>
            {plugin.name}
          </div>
          <div class="action-group-items">
            {#each plugin.actions as action}
              <button
                class="action-item"
                on:click={() => dispatch('use', {
                  name: action.name,
                  actionUUID: action.uuid,
                  settings: {},
                })}
              >
                {action.name}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .right-panel { width: 220px; border-left: 1px solid #3a3a3c; display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; }
  .right-header { padding: 0.65rem 0.65rem 0.5rem; flex-shrink: 0; border-bottom: 1px solid #3a3a3c; }
  .search-input { width: 100%; background: #2a2a2c; border: 1px solid #3a3a3c; color: #f0f0f0; padding: 0.35rem 0.65rem; border-radius: 0.35rem; font-size: 0.8rem; }
  .search-input::placeholder { color: #555; }
  .search-input:focus { outline: 1px solid #4f46e5; border-color: #4f46e5; }
  .actions-list { flex: 1; overflow-y: auto; padding: 0.4rem 0.4rem 0.75rem; }
  .action-group { margin-top: 0.35rem; }
  .action-group-header { display: flex; align-items: center; gap: 0.35rem; font-size: 0.68rem; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.07em; padding: 0.35rem 0.4rem 0.2rem; }
  .status-dot { font-size: 0.6rem; flex-shrink: 0; }
  .action-group-items { display: flex; flex-direction: column; gap: 1px; }
  .action-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.6rem; border-radius: 0.35rem; font-size: 0.8rem; color: #bbb; cursor: pointer; background: none; border: none; width: 100%; text-align: left; }
  .action-item:hover { background: #2a2a2c; color: #f0f0f0; }
  .empty { font-size: 0.75rem; color: #555; padding: 0.5rem 0.4rem; }
  .load-error { font-size: 0.75rem; color: #f87171; padding: 0.5rem 0.4rem; word-break: break-all; }
</style>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/desktop && npm run build 2>&1 | grep -i "error" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/components/ActionSidebar.svelte
git commit -m "feat: dynamic ActionSidebar sourced from listPlugins"
```

---

### Task 5: Plugin-aware ButtonEditor with Property Inspector iframe

**Files:**
- Modify: `packages/desktop/src/components/ButtonEditor.svelte`
- Modify: `packages/desktop/src/App.svelte`

**Logic:**
- `isBuiltIn`: action UUID starts with `com.pannacotta.` → keep existing hardcoded form
- `pluginAction`: find the plugin + action object for the selected button's actionUUID
- `hasPi`: `pluginAction?.action.piPath != null`
- PI iframe (for non-built-in with PI): `http://127.0.0.1:{port}/pi/{plugin_uuid}/{pi_path}?port={port}&uuid={context}&registerEvent=registerPropertyInspector&info=%7B%7D&actionInfo={encoded}`
- JSON editor (for non-built-in without PI): `<textarea>` bound to `JSON.stringify(settings, null, 2)`
- Built-in: existing name/type/icon/action form

The PI iframe communicates settings changes back to the plugin over WebSocket. The admin UI does not intercept those messages — the PI iframe is self-contained. Saving to config still uses the existing `handleSave` path; when using PI the user clicks Save separately to persist current settings.

- [ ] **Step 1: Update `App.svelte` to fetch plugins and pass to ButtonEditor**

In `App.svelte`, add `listPlugins` to the import line:

```typescript
import { getConfig, getDefaultConfig, listProfiles, openConfigFolder, getServerInfo, listPlugins } from './lib/invoke'
import type { StreamDeckConfig, Profile, ServerInfo, PluginInfo } from './lib/types'
```

Add `plugins` state variable after `serverInfo`:

```typescript
let plugins: PluginInfo[] = []
```

Update the `reload` function to also fetch plugins:

```typescript
async function reload() {
  const [cfg, profs, info, plugs] = await Promise.all([getConfig(), listProfiles(), getServerInfo(), listPlugins()])
  config = cfg
  profiles = profs
  serverInfo = info
  plugins = plugs
  selectedIndex = -1
}
```

Update the `ButtonEditor` element in the template to pass `serverInfo` and `plugins`:

```svelte
<ButtonEditor
  bind:this={editorRef}
  {config}
  {selectedIndex}
  {serverInfo}
  {plugins}
  on:save={reload}
  on:toast={e => showToast(e.detail.message, e.detail.ok)}
/>
```

- [ ] **Step 2: Rewrite `ButtonEditor.svelte`**

Replace the entire file:

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { saveConfig } from '../lib/invoke'
  import type { Button, StreamDeckConfig, ServerInfo, PluginInfo } from '../lib/types'

  export let config: StreamDeckConfig
  export let selectedIndex: number = -1
  export let serverInfo: ServerInfo | null = null
  export let plugins: PluginInfo[] = []

  const dispatch = createEventDispatcher<{
    save: void
    toast: { message: string; ok: boolean }
  }>()

  const MEDIA_ACTIONS = ['volume-up', 'volume-down', 'volume-mute', 'brightness-up', 'brightness-down', 'sleep', 'lock']

  let name = ''
  let formType: 'browser' | 'system' = 'browser'
  let icon = ''
  let action = ''
  let jsonSettings = '{}'

  function isBuiltInUUID(uuid: string): boolean {
    return uuid.startsWith('com.pannacotta.')
  }

  function findPluginAction(uuid: string) {
    for (const plugin of plugins) {
      const act = plugin.actions.find(a => a.uuid === uuid)
      if (act) return { plugin, action: act }
    }
    return null
  }

  function buttonToForm(btn: Button): { formType: 'browser' | 'system'; action: string } {
    const uuid = btn.actionUUID
    if (uuid === 'com.pannacotta.browser.open-url') {
      return { formType: 'browser', action: String((btn.settings as Record<string, unknown>)?.url ?? '') }
    }
    if (uuid.startsWith('com.pannacotta.system.')) {
      const actionName = uuid.replace('com.pannacotta.system.', '')
      if (actionName === 'open-app') {
        return { formType: 'system', action: String((btn.settings as Record<string, unknown>)?.appName ?? '') }
      }
      return { formType: 'system', action: actionName }
    }
    return { formType: 'system', action: '' }
  }

  function formToButton(existingCtx: string): Button {
    let actionUUID: string
    let settings: Record<string, unknown>
    if (formType === 'browser') {
      actionUUID = 'com.pannacotta.browser.open-url'
      settings = { url: action.trim() }
    } else if (MEDIA_ACTIONS.includes(action.trim())) {
      actionUUID = `com.pannacotta.system.${action.trim()}`
      settings = {}
    } else {
      actionUUID = 'com.pannacotta.system.open-app'
      settings = { appName: action.trim() }
    }
    const context = existingCtx || Math.random().toString(36).slice(2, 14)
    return { name: name.trim(), icon: icon.trim(), actionUUID, context, settings }
  }

  $: selectedBtn = selectedIndex >= 0 ? (config.buttons[selectedIndex] ?? null) : null
  $: isEditing = selectedBtn !== null
  $: pluginAction = selectedBtn ? findPluginAction(selectedBtn.actionUUID) : null
  $: isBuiltIn = selectedBtn ? isBuiltInUUID(selectedBtn.actionUUID) : true
  $: hasPi = !isBuiltIn && pluginAction?.action.piPath != null
  $: showJsonEditor = !isBuiltIn && !hasPi && pluginAction != null

  $: piUrl = (() => {
    if (!hasPi || !serverInfo || !selectedBtn || !pluginAction?.action.piPath) return null
    const { plugin, action: act } = pluginAction
    const actionInfo = JSON.stringify({
      action: selectedBtn.actionUUID,
      context: selectedBtn.context,
      device: '',
      payload: { settings: selectedBtn.settings ?? {} },
    })
    const params = new URLSearchParams({
      port: String(serverInfo.port),
      uuid: selectedBtn.context,
      registerEvent: 'registerPropertyInspector',
      info: '{}',
      actionInfo,
    })
    return `http://127.0.0.1:${serverInfo.port}/pi/${plugin.uuid}/${act.piPath}?${params.toString()}`
  })()

  $: if (selectedIndex >= 0) {
    const btn = config.buttons[selectedIndex]
    if (btn) {
      name = btn.name
      icon = btn.icon
      if (isBuiltIn) {
        const f = buttonToForm(btn)
        formType = f.formType
        action = f.action
      } else {
        jsonSettings = JSON.stringify(btn.settings ?? {}, null, 2)
      }
    } else {
      name = ''; formType = 'browser'; icon = ''; action = ''; jsonSettings = '{}'
    }
  }

  export function prefill(btn: Partial<Button>) {
    if (btn.name !== undefined) name = btn.name
    if (btn.icon !== undefined) icon = btn.icon
    if (btn.actionUUID !== undefined) {
      if (isBuiltInUUID(btn.actionUUID)) {
        const f = buttonToForm({ actionUUID: btn.actionUUID, settings: btn.settings ?? {}, name: '', icon: '', context: '' })
        formType = f.formType
        action = f.action
      } else {
        jsonSettings = JSON.stringify(btn.settings ?? {}, null, 2)
      }
    }
  }

  function toast(message: string, ok: boolean) { dispatch('toast', { message, ok }) }

  async function handleSave() {
    if (!name.trim() || !icon.trim()) {
      toast('Fill in name and icon', false); return
    }
    let btn: Button
    if (isBuiltIn) {
      if (!action.trim()) { toast('Fill in all fields', false); return }
      const existingCtx = selectedBtn?.context ?? ''
      btn = formToButton(existingCtx)
      btn.name = name.trim()
      btn.icon = icon.trim()
    } else if (pluginAction) {
      let parsedSettings: Record<string, unknown> = {}
      if (!hasPi) {
        try {
          parsedSettings = JSON.parse(jsonSettings)
        } catch {
          toast('Settings JSON is invalid', false); return
        }
      } else {
        parsedSettings = selectedBtn?.settings ?? {}
      }
      const context = selectedBtn?.context || Math.random().toString(36).slice(2, 14)
      btn = { name: name.trim(), icon: icon.trim(), actionUUID: pluginAction.action.uuid, context, settings: parsedSettings }
    } else {
      toast('Unknown action type', false); return
    }
    const newButtons = [...config.buttons]
    if (selectedIndex >= 0) {
      while (newButtons.length <= selectedIndex) newButtons.push(null as unknown as Button)
      newButtons[selectedIndex] = btn
    } else {
      newButtons.push(btn)
    }
    await saveConfig({ ...config, buttons: newButtons.filter(Boolean) })
      .then(() => { toast('Saved!', true); dispatch('save') })
      .catch(e => toast(String(e), false))
  }

  async function handleDelete() {
    if (selectedIndex < 0) return
    const newButtons = config.buttons.filter((_, i) => i !== selectedIndex)
    await saveConfig({ ...config, buttons: newButtons })
      .then(() => { toast('Deleted', true); dispatch('save') })
      .catch(e => toast(String(e), false))
  }

  function handleClear() {
    name = ''; formType = 'browser'; icon = ''; action = ''; jsonSettings = '{}'
  }
</script>

<div class="editor-panel">
  <div class="editor-header">
    <span class="editor-title">
      {isEditing ? `Edit: ${selectedBtn?.name ?? ''}` : selectedIndex >= 0 ? `Add to slot ${selectedIndex + 1}` : 'Add Button'}
    </span>
  </div>

  <div class="editor-fields">
    <div class="field"><label for="btn-name">Name</label><input id="btn-name" bind:value={name} placeholder="GitHub" /></div>
    <div class="field"><label for="btn-icon">Icon (Lucide name)</label><input id="btn-icon" bind:value={icon} placeholder="github" /></div>

    {#if isBuiltIn}
      <div class="field">
        <label for="btn-type">Type</label>
        <select id="btn-type" bind:value={formType}>
          <option value="browser">browser</option>
          <option value="system">system</option>
        </select>
      </div>
      <div class="field full"><label for="btn-action">Action (URL or app name)</label><input id="btn-action" bind:value={action} placeholder="https://github.com" /></div>
    {:else if hasPi && piUrl}
      <div class="field full pi-wrapper">
        <label>Property Inspector</label>
        <iframe title="Property Inspector" src={piUrl} class="pi-frame" sandbox="allow-scripts allow-same-origin"></iframe>
      </div>
    {:else if showJsonEditor}
      <div class="field full">
        <label for="btn-json">Settings (JSON)</label>
        <textarea id="btn-json" bind:value={jsonSettings} rows="4" spellcheck="false"></textarea>
      </div>
    {:else if selectedBtn && !isBuiltIn && !pluginAction}
      <div class="field full">
        <p class="unknown-action">Unknown action: {selectedBtn.actionUUID}</p>
      </div>
    {/if}
  </div>

  <div class="editor-actions">
    <button class="btn" on:click={handleSave}>{isEditing ? 'Update' : 'Add'}</button>
    <button class="btn secondary" on:click={handleClear}>Clear</button>
    {#if isEditing}
      <button class="btn danger" on:click={handleDelete}>Delete</button>
    {/if}
  </div>
</div>

<style>
  .editor-panel { background: #252527; border-radius: 0.6rem; padding: 0.75rem; }
  .editor-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem; }
  .editor-title { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .editor-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .field { display: flex; flex-direction: column; gap: 0.2rem; }
  .field label { font-size: 0.7rem; color: #777; }
  .field input, .field select, .field textarea { background: #1c1c1e; border: 1px solid #3a3a3c; color: #f0f0f0; padding: 0.32rem 0.55rem; border-radius: 0.35rem; font-size: 0.82rem; width: 100%; }
  .field textarea { resize: vertical; font-family: monospace; }
  .field input:focus, .field select:focus, .field textarea:focus { outline: 1px solid #4f46e5; border-color: #4f46e5; }
  .field.full { grid-column: 1/-1; }
  .pi-wrapper { gap: 0.35rem; }
  .pi-frame { width: 100%; height: 240px; border: 1px solid #3a3a3c; border-radius: 0.35rem; background: #1c1c1e; }
  .unknown-action { font-size: 0.75rem; color: #f87171; margin: 0; }
  .editor-actions { display: flex; gap: 0.4rem; margin-top: 0.55rem; }
  .btn { background: #4f46e5; color: #fff; border: none; padding: 0.35rem 0.85rem; border-radius: 0.35rem; cursor: pointer; font-size: 0.8rem; }
  .btn:hover { background: #6366f1; }
  .btn.secondary { background: #2a2a2c; border: 1px solid #3a3a3c; color: #ccc; }
  .btn.secondary:hover { background: #3a3a3c; color: #f0f0f0; }
  .btn.danger { background: transparent; color: #f87171; border: 1px solid #3a3a3c; }
  .btn.danger:hover { background: #2e1a1a; border-color: #f87171; }
</style>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/desktop && npm run build 2>&1 | grep -i "error" | head -10
```

Expected: no TypeScript errors, build succeeds.

- [ ] **Step 4: Run Rust tests (no Rust changes in this task, just sanity)**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/components/ButtonEditor.svelte \
        packages/desktop/src/App.svelte
git commit -m "feat: plugin-aware ButtonEditor with PI iframe and JSON settings fallback"
```

---

## Final Verification

After all tasks complete:

```bash
# Rust: all tests pass, no clippy errors
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -10
cd packages/desktop/src-tauri && cargo clippy 2>&1 | grep "^error"

# Frontend: clean build
cd packages/desktop && npm run build 2>&1 | grep -i "error"
```

Expected: all clean.

### Manual smoke test

1. `cd packages/desktop && npm run tauri dev`
2. Open Admin Config window
3. **ActionSidebar** — verify: built-in "Browser" and "System" groups appear, status badge 🟢 next to each (plugins are running), search filter works
4. **Add a button** — click an action from sidebar, verify name/icon/type pre-fill in ButtonEditor
5. **Edit a built-in action** — select an existing button with `com.pannacotta.browser.open-url`, verify old URL/type form still appears
6. **Third-party PI action** — if a third-party `.sdPlugin` with `PropertyInspectorPath` in its manifest is installed, select a button with that action, verify PI iframe appears
7. **Third-party no-PI action** — third-party action without PI path shows JSON textarea

---

## Spec Coverage

| Requirement | Task |
|---|---|
| Dynamic action list from plugin system | Task 4 |
| Plugin status badge (running/errored/etc) | Task 4 |
| PI iframe for plugin actions with PropertyInspectorPath | Task 5 |
| JSON settings editor fallback (no PI) | Task 5 |
| Built-in actions keep existing form | Task 5 |
| PropertyInspectorPath in manifest + API | Task 1 |
| list_plugins_cmd Tauri command | Task 2 |
| PluginInfo TypeScript types | Task 3 |
