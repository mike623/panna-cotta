# Plugin System Design

**Date:** 2026-05-04  
**Branch:** cubic-game  
**Status:** Revision 11 — self-review (Codex usage limit reached after round 10)

## Goal

Replace Panna Cotta's hardcoded action system with an extensible plugin architecture
compatible with the Elgato Stream Deck WebSocket protocol for **Node.js plugins that
use only the implemented event set**.

**Phase 1 scope:** Plugin/host runtime communication for simple actions (open-app,
open-url, media controls, run-command, custom API calls) works with unmodified Node.js
plugins. PI (Property Inspector) compatibility requires Phase 2 empirical verification
against a real `@elgato/streamdeck` PI before claiming support.

Plugins requiring `setImage`, `setState`, or global settings are out of scope for v1
and will fail with a visible admin UI warning.

**Compatibility target:** Elgato SDK v2, `@elgato/streamdeck` package ≥ 6.x,
Node.js `CodePath` plugins only.

**Reference:** [OpenDeck](https://github.com/nekename/OpenDeck)

---

## Protocol Coverage

| Event | Direction | v1 | Notes |
|---|---|---|---|
| `registerPlugin` | plugin→host | ✅ | |
| `registerPropertyInspector` | PI→host | ✅ | PI auth via token; Phase 2 QA required |
| `keyDown` / `keyUp` | host→plugin | ✅ | |
| `willAppear` / `willDisappear` | host→plugin | ✅ | |
| `deviceDidConnect` | host→plugin | ✅ | single device "main" |
| `setTitle` | plugin→host | ✅ | |
| `setSettings` | plugin→host | ✅ | persisted to JSON |
| `getSettings` | plugin→host | ✅ | |
| `showOk` / `showAlert` | plugin→host | ✅ | |
| `openUrl` | plugin→host | ✅ | URL-parser scheme validation |
| `logMessage` | plugin→host | ✅ | to plugin log file |
| `sendToPropertyInspector` | plugin→host→PI | ✅ | |
| `sendToPlugin` | PI→host→plugin | ✅ | |
| `setState` / `setImage` / global settings | plugin→host | ❌ | ignored + **admin UI warning** |
| Other unsupported events | any | ❌ | ignored + admin UI warning |

**Unsupported event handling:** Silently dropped on the wire (no error response sent —
would break plugins). Per-plugin `unsupported_events: HashSet<String>` accumulates unique
names in memory. Admin UI shows the deduplicated set; cleared on plugin restart. Persisted
to plugin log file so warnings survive restarts.

---

## 1. Architecture

```
LAN clients (0.0.0.0:N)                  Localhost + CSRF required
────────────────────────                  ──────────────────────────────────────────
GET  /api/config (redacted)               PUT  /api/config
GET  /api/profiles                        POST /api/profiles
GET  /api/plugins                         PATCH/DELETE /api/profiles/:name
GET  /api/plugins/:uuid/status (redacted) POST /api/plugins/install
GET  /api/config/default                  DELETE /api/plugins/:uuid
GET  /api/health                          POST /api/open-config-folder
GET  /apps/*                              POST /api/open-app   ← gated Phase 1
                                          POST /api/open-url   ← gated Phase 1

POST /api/execute     ← LAN: { context } only, no CSRF; localhost: CSRF required
POST /api/profiles/:name/activate  ← LAN: allowed, no CSRF; localhost: CSRF required

GET  /ws              ← localhost-only (ConnectInfo + Origin check); token-based auth; NO CSRF
GET  /pi/*            ← localhost-only (ConnectInfo only); path-safe; NO CSRF; token generated on HTML serve
```

Single Axum listener on `0.0.0.0:N`. Axum version: repo uses `axum = "0.7"` — keep
existing `:name` route parameter syntax.

### AppState

```rust
pub struct AppState {
    pub config_dir: PathBuf,
    pub port: std::sync::Mutex<Option<u16>>,
    pub csrf_token: String,                                    // generated at startup
    pub plugin_host: Arc<tokio::sync::Mutex<PluginHost>>,
}
```

`csrf_token` is in `AppState` directly (not in `PluginHost`) so middleware can read it
without acquiring the plugin lock.

### Startup sequence

```
1. migrate_old_config → load active profile JSON into memory
2. construct AppState: generate csrf_token, build PluginHost with profile_state
3. start Axum server (bind listener, write port to disk)
4. spawn plugins (after WS endpoint is live — plugins connect immediately)
5. fire deviceDidConnect for all plugins, then willAppear per visible button
   (Elgato ordering: device appears before button appearances)
```

---

## 2. Security Model

### Plugin trust level (explicit)

Installed plugins run as native Node.js processes with full user-level OS access.
Security controls govern the **host-side API surface only**; they do not sandbox plugin
code. Plugins are treated as fully trusted, native-code-equivalent extensions.

### ConnectInfo setup

```rust
// server/mod.rs
axum::serve(
    listener,
    create_router(state).into_make_service_with_connect_info::<SocketAddr>(),
).await
```

### Localhost + CSRF middleware

Admin routes (all mutating endpoints): source IP must be `127.0.0.1` / `::1` AND carry
valid `X-Panna-CSRF` header. The CSRF token is a 32-byte hex random in `AppState.csrf_token`.
The admin UI receives it via Tauri command `get_csrf_token()`.

`/ws` and `/pi/*`: localhost-only (ConnectInfo) + role-token auth. **No CSRF.** Applying
CSRF to `/ws` would break PI iframes; applying CSRF to `/pi/*` would break plugin HTML
delivery.

### Tauri IPC boundary and hardening

Tauri commands are restricted using capability files. Required changes to ship Phase 1:

1. **Set non-null CSP** in `tauri.conf.json`. Current `"csp": null` must be replaced with
   a strict policy (e.g., `default-src 'self'`). This prevents content injection that
   could reach parent-frame Tauri IPC.

2. **Review `withGlobalTauri`**: Current `withGlobalTauri: true` exposes the full Tauri
   API surface globally. Scope it to the capabilities actually needed or disable if the
   admin UI uses `@tauri-apps/api` imports instead.

3. **Capability scope for `get_csrf_token`**: In `capabilities/default.json`, bind the
   `get_csrf_token` command to the admin window's origin only (`tauri://localhost`). Do
   not add it to any capability that applies to webviews loading external HTTP origins.

4. **All custom Tauri commands scoped to admin window:** Not just `get_csrf_token` —
   `execute_command`, `open_app`, `open_url`, and all other commands in `commands/`
   must be registered only in the capability that applies to the admin window origin
   (`tauri://localhost`). No custom commands are accessible from external HTTP origins
   or plugin PI iframes.

5. **PI iframe SOP boundary**: PI iframes load from `http://127.0.0.1:N` — a different
   origin from the admin webview (`tauri://localhost`). Cross-origin iframes cannot
   access the parent frame's JavaScript context (SOP). However, **do not rely solely on
   this** — implement the capability restriction in point 4 as the enforceable boundary.
   Required negative test: PI iframe cannot invoke any Tauri command (see Testing Plan).

### LAN execute — trust model

**Panna Cotta's core product model:** the phone IS the Stream Deck remote. Any device on
the LAN can trigger any configured button from the phone UI. This is equivalent to a
physical Stream Deck being visible on a desk — anyone who can reach it can press it.

`POST /api/execute { context }` from LAN: unauthenticated, no CSRF. ALL configured
actions are LAN-triggerable, including third-party plugin actions. This is intentional.

**Trust model:** Panna Cotta is a trusted-LAN product. Users who configure buttons that
perform sensitive operations (shell commands, API calls, file operations) accept the
exposure to other devices on their LAN.

**Per-button opt-out (`lan_allowed` field):** `None` or `true` = LAN-triggerable.
`false` = localhost+CSRF only (phone cannot trigger this button). Admin UI allows
toggling per-button. When `false`, `/api/execute { context }` from LAN returns 403.
Admin UI shows ⚠ on buttons with `lan_allowed = false` (reminder: won't work from phone).

Default is `true` for ALL actions including `run-command`. This is explicit-opt-out —
the core use case is phone-as-remote. Users who want to block LAN triggering for
sensitive buttons must explicitly set `lan_allowed = false`.

**LAN phone authentication (pairing tokens):** out of scope for v1. If the user is on
an untrusted network, they should not run Panna Cotta on that interface.

Legacy `{ action, target }` is **not** accepted from LAN. Only `{ context }`.

### Legacy `{ action, target }` validation (localhost + CSRF only)

| Legacy `action` | Legacy `target` | Required button in active profile |
|---|---|---|
| `open-app` | app name string | `actionUUID == "com.pannacotta.system.open-app"` AND `settings.appName == target` |
| `volume-up` / `volume-down` / `volume-mute` / `brightness-up` / `brightness-down` / `sleep` / `lock` | (any) | `actionUUID == "com.pannacotta.system.{action}"` |
| anything else | any | **REJECTED** |

`run-command` never accepted via legacy path. If no matching button found in active profile: 403.

### PI iframe security

PI code at `http://127.0.0.1:N` can:
- Read `GET /api/config` (redacted — no CSRF token → no `settings`)
- Read `GET /api/plugins`
- Open WebSocket to `/ws` (with PI token — not CSRF)

PI CANNOT call `POST /api/execute` even with `{ context }`: the PI is on localhost, and
`/api/execute` from localhost requires CSRF. PI cannot obtain the CSRF token (Tauri IPC
boundary — see above). This is the desired behavior.

PI CANNOT call any Tauri commands (Tauri IPC iframe boundary — see above).

### `/api/open-app` and `/api/open-url` — gated in Phase 1

Moved to localhost + CSRF. Current implementation passes arbitrary strings to `open`
([system.rs:44-59](/packages/desktop/src-tauri/src/commands/system.rs)); `open_url` must
add URL-parser scheme validation in Phase 1 to match the `openUrl` event whitelist.

### `/api/config` GET — redacted when no CSRF

- **CSRF token present:** Full config including `settings` for all buttons.
- **No CSRF token (LAN, PI iframes):** `settings` stripped. Note: `context`, `name`,
  `icon`, and `actionUUID` are LAN-visible (phones need `context` to press buttons).

### `/api/plugins/:uuid/status`

- No CSRF: `logTail` omitted.
- CSRF: full status including `logTail` and `settings_not_persisted` flag.

### WebSocket auth — provisional accept then authenticate

The WS HTTP upgrade happens before any payload is available. Authentication is
therefore two-phase:

**Security disclaimer:** UUID-timing auth is correlation, not strong authentication.
Any local process that reads plugin manifests could race the 10s window. This is accepted
under the full-trust plugin model (a malicious plugin can already do anything) and the
assumption that no unrelated malicious processes run locally. Not designed to prevent
local privilege escalation.

**Phase A — HTTP upgrade (before any WS messages):**
1. ConnectInfo must be `127.0.0.1` / `::1`.
2. `Origin` header check:
   - No `Origin` (native process): provisionally accept; start 5s auth timer.
   - `Origin == http://127.0.0.1:{port}`: provisionally accept (PI iframe); check PI
     token on first message.
   - Any other `Origin`: reject upgrade with 403 immediately.

**Phase B — First WS message (within 5s or connection closed):**

*Plugin (`registerPlugin` event):*
- `uuid` must be in `PluginHost.pending_registrations`
- Spawn time must be < 10s ago
- No existing registered connection for this UUID
- All pass → remove from `pending_registrations`, mark registered, flush pre-reg queue

*PI (`registerPropertyInspector` event):*
- `token` from WS query string (`?token=...`) must be in `PluginHost.pi_token_map`; `plugin_uuid` resolved from token
- Token removed from `pi_token_map` (consumed; reuse rejected)
- Resolved `plugin_uuid` must exist and be in running/registered state; reject if not found

Edge cases:
- Plugin: unknown UUID or expired window → close after failure
- Plugin: duplicate UUID → first wins, second closed
- PI: wrong or consumed token → close
- Any connection: no first message within 5s → close

### `openUrl` scheme validation

Use `url::Url::parse()` to parse the URL. Accept only `https` and `http` schemes.
All others rejected and logged. String prefix matching is insufficient.

**All three paths validated:**
1. WS `openUrl` event handler (plugin sends event)
2. Tauri `open_url` command (admin UI calls directly)
3. **Button execute path** — when `/api/execute { context }` resolves a
   `com.pannacotta.browser.open-url` button, the execute handler validates
   `settings.url` before passing to the OS opener. Profile data may contain arbitrary
   URLs (migrated from old format, manually edited files). Current `open_url` in
   `system.rs:53` passes arbitrary strings to `open` — Phase 1 adds validation on all
   three paths.

### npm install security

Admin UI: "npm packages run install scripts during installation. Only install from
trusted sources." Package name: standard npm name pattern only (no git URLs, no file
paths).

### Archive extraction safety

Node.js runtime download and plugin archive extraction must reject:
- Absolute paths
- Path components containing `..`
- **All symlinks** (simpler and safer than attempting to resolve targets that may not
  exist yet; symlink-following attacks via later archive entries can't be fully prevented
  by runtime canonicalization)
- Hard links
- Device nodes, FIFOs, sockets
- Any attempt to restore setuid/setgid bits or change ownership

---

## 3. Data Model & Config Migration

### Button schema

```
Current TOML:                New JSON:
─────────────────────        ─────────────────────────────────────
name = "Calculator"          { "name": "Calculator",
type = "system"                "icon": "calculator",
icon = "calculator"            "actionUUID": "com.pannacotta.system.open-app",
action = "Calculator"          "context": "h7xKp2mN4qRs",
                               "settings": { "appName": "Calculator" } }
```

### Context ID

12-char nanoid. Collision-checked within the profile on generation.
Lifecycle: created → new; moved → preserved; duplicated → new; profile-duplicated →
new; migrated → new.

### Elgato event payload

```json
{
  "event": "keyDown",
  "action": "com.pannacotta.system.open-app",
  "context": "h7xKp2mN4qRs",
  "device": "main",
  "payload": {
    "settings": { "appName": "Calculator" },
    "coordinates": { "column": 0, "row": 0 },
    "state": 0,
    "isInMultiAction": false
  }
}
```

`column = index % cols`, `row = index / cols`. Page 0 only.

### Plugin UUID

= manifest top-level `UUID` field. Not the directory name.

### Profile state ownership

`PluginHost.profile_state: Arc<tokio::sync::Mutex<StreamDeckConfig>>` is the single
source of truth for the active profile. All paths — UI config saves, profile activation,
migration, and plugin `setSettings` — go through the same lock.

Profile activation: loads new profile JSON into `profile_state`, triggers lifecycle diff.
After activation, any pending `setSettings` with a context not in the new profile is
silently ignored.

### Rust Button type

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Button {
    pub name: String,
    pub icon: String,
    #[serde(rename = "actionUUID")]
    pub action_uuid: String,
    pub context: String,
    #[serde(default)]
    pub settings: serde_json::Value,
    #[serde(default, rename = "lanAllowed")]
    pub lan_allowed: Option<bool>,   // None = true (all actions LAN-triggerable by default; set false to block LAN)
}
```

### Profile files: TOML → JSON

Extension-aware `profile_path()`: returns `.json` if exists, else `.toml`.
`save_stream_deck_config()` always writes `.json`. Listing: `.json` wins over `.toml`;
`.json.tmp` files ignored. Delete removes `.json`, `.toml.bak`, and `.json.tmp`.

**Migration on startup:** TOML without corresponding JSON → read, convert, write
`.json.tmp`, atomic rename to `.json`, original → `.toml.bak`. Idempotent. Failure
leaves TOML intact.

### Migration mapping

| Old `type` | Old `action` | New `actionUUID` | New `settings` |
|---|---|---|---|
| `system` | `volume-up/down/mute/brightness-up/down/sleep/lock` | `com.pannacotta.system.{action}` | `{}` |
| `system` | any other value (app name) | `com.pannacotta.system.open-app` | `{"appName": "<action>"}` |
| `browser` | any value (URL) | `com.pannacotta.browser.open-url` | `{"url": "<action>"}` |

### `setSettings` / `getSettings`

`profile_state` uses `tokio::sync::Mutex`, which is async-safe to hold across async I/O
(no thread blocking). Procedure: acquire tokio Mutex → find button by `context` →
update `settings` in-memory → write to disk atomically (tmp+rename) while holding the
lock → release. Concurrent `setSettings` calls and profile activation serialize on the
Mutex, preventing out-of-order disk writes and profile-switch races.

**v1 accepted tradeoff:** serializing all profile writes behind one Mutex (including
filesystem latency) is simple and correct. If profiling shows visible UI latency (e.g.,
`setSettings` from multiple plugins stalling the admin save), a per-profile write actor
can be added in v2.

If disk write fails: set `PluginState.settings_not_persisted = true`; surface warning
in admin UI. In-memory state is updated. Plugin not notified.

Edge cases:
- **Unknown context:** Silently ignored and logged.
- **Stale PI context after profile switch:** context not found in new profile → ignored.
- **Profile switch while PI is open:** PI connection stays open; stale contexts ignored.

---

## 4. WebSocket Host & Process Manager

### PluginHost

```rust
pub struct PluginHost {
    pub registry: HashMap<String, String>,                   // actionUUID → pluginUUID
    pub plugins: HashMap<String, PluginState>,               // keyed by pluginUUID
    pub pending_registrations: HashMap<String, Instant>,     // UUID → spawn time
    pub pi_token_map: HashMap<String, String>,               // PI token → plugin_uuid
    pub profile_state: Arc<tokio::sync::Mutex<StreamDeckConfig>>,
}

pub struct PluginState {
    pub process: Option<tokio::process::Child>,              // tokio async process
    pub process_group_id: Option<u32>,                       // Unix: pgid
    pub sender: Option<mpsc::Sender<PluginEvent>>,           // bounded(256)
    pub pre_reg_queue: VecDeque<PluginEvent>,                 // ≤100, new dropped on overflow
    pub restart_handle: Option<JoinHandle<()>>,
    // PI tokens moved to PluginHost.pi_token_map (global lookup)
    pub status: PluginStatus,
    pub unsupported_events: HashSet<String>,                 // deduplicated; shown in admin UI
    pub settings_not_persisted: bool,
    pub crash_count: u32,
    pub last_crash_window_start: Instant,
}
```

### Locking contract

`PluginHost` uses `tokio::sync::Mutex`. Rules:

1. **Lock to mutate maps or extract data, then release.** Clone a `Sender`, read a
   field, insert/remove an entry — release immediately after.
2. **Never await while holding the PluginHost lock.** `try_send` is synchronous (not
   an await) and is safe inside the lock. Any `.await` requires releasing the lock first.
3. **Process child ownership:** To kill or wait on a process, `take()` the
   `Option<Child>` from `PluginState` while holding the lock (removes it from the map),
   release the lock, then perform the async wait/kill. Never await `child.kill()` or
   `child.wait()` inside the lock.
4. **Consistent lock order:** If both `PluginHost` and `profile_state` locks are needed,
   acquire `PluginHost` first, extract/clone the profile reference, release `PluginHost`,
   then acquire `profile_state`.
5. **Disk I/O:** Always outside the `PluginHost` lock. (`profile_state` lock may be held
   across disk I/O since it uses `tokio::sync::Mutex` — see Section 3.)

### Process manager lifecycle

Profile load → spawn processes → fire `deviceDidConnect` then `willAppear` per button
(Elgato ordering: device connect precedes appearance events).  
Profile switch → diff, cancel restarts, clear queues, `willDisappear`, terminate leaving,
spawn arriving, `willAppear` for arriving.  
Crash → backoff restart (cancellable) → errored at 5 crashes/60s.  
`willAppear` guarantee: events queued pre-registration; flushed in order on register;
cleared on crash-reconnect (fresh `willAppear` fired instead).

### Plugin launch

```bash
{node_binary} {CodePath} -port {N} -pluginUUID {manifest.UUID} \
  -registerEvent registerPlugin \
  -info '{"application":{"version":"0.x.x"},"devices":[{"id":"main","type":0,"size":{"columns":5,"rows":3}}]}'
```

No `-token` arg — unmodified SDK plugins do not echo custom CLI args in `registerPlugin`.
Auth is by UUID + timing + no-Origin-header check (Section 2). Uses `tokio::process::Command`
(not `std::process::Command`) so kill/wait are async-safe.

### PI token lifecycle

On `GET /pi/{uuid}/{path}` for a `text/html` response (localhost-only, no CSRF required):
1. Generate 32-byte random hex PI token.
2. Store in `PluginHost.pi_token_map: HashMap<String, String>` (`token → plugin_uuid`).
3. Inject into bridge script: `const PI_TOKEN = '{token}';`

On `registerPropertyInspector`:
- Look up `plugin_uuid` from the token in a global `pi_token_map: HashMap<String, String>`
  (`token → plugin_uuid`). The PI's `uuid` field in the WS message is NOT used to
  determine plugin identity — only the token is authoritative.
- Remove token from `pi_token_map` (consumed).
- Validate that the resolved `plugin_uuid` exists and is in running/registered state.
- Reject if token not found or plugin not running.

**Note on `inUUID` in Elgato SDK:** `inUUID` passed to `connectElgatoStreamDeckSocket`
is implementation-defined and may be the plugin UUID or an action context UUID depending
on SDK version. Server-side token→plugin_uuid binding avoids relying on the PI's self-reported
identity. Requires Phase 2 empirical verification.

**Cross-plugin PI token note:** tokens are global (`pi_token_map`), not per-plugin.
A PI page from plugin A requesting `/pi/pluginB/pi.html` would get a token that maps
to plugin B. This is accepted under the full-trust model (plugins can already do anything).

**`pi_token_map` location:** stored in `PluginHost` (not per `PluginState`) for O(1)
token lookup without scanning all plugins.

### Process group cleanup

Unix: spawn with `process_group(0)` (creates new process group; pgid = child PID). Kill by pgid via `libc::killpg` (SIGTERM → 2s → SIGKILL).
Windows: spawn with Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`;
`CloseHandle` on the job terminates all associated processes. The handle must be owned
by the host process and not inherited by plugins.

### Channel bounds

`mpsc::channel(256)` per plugin. `try_send` failure → new event dropped + logged.

### Shutdown

1. `willDisappear` for all visible buttons  
2. Cancel all `restart_handle`s  
3. SIGTERM process groups / Job Object close  
4. 2s grace → SIGKILL  
5. Flush logs  
6. `app.exit(0)`

---

## 5. Plugin Discovery & Installation

Discovery sources: drop-in `*.sdPlugin/`, npm root, scoped npm `@scope/name`. Scanner
looks for `*.sdPlugin/` one level deep in each npm package. Symlinks followed only if
canonical path stays within `~/.panna-cotta/`.

Duplicate UUID: drop-in wins over npm; alphabetically first within same source (compare
after Unicode normalization and lowercase, since macOS filesystems are case-insensitive).

Manifest hard blocks: missing UUID, invalid/missing CodePath (must be `.js`), CodePath
escapes plugin dir, empty Actions, duplicate Action UUIDs, OS mismatch, SDKVersion > 2.

Uninstall safety: reject if UUID in any profile button (409 + profile list).

### API routes

```
GET    /api/plugins               (LAN OK — read only)
POST   /api/plugins/install       (localhost + CSRF)
DELETE /api/plugins/:uuid         (localhost + CSRF)
GET    /api/plugins/:uuid/status  (no CSRF: no logTail; CSRF: full)
```

---

## 6. Built-in Plugins

Copied from Tauri resources to `~/.panna-cotta/plugins/` on startup (semver gating).
`com.pannacotta.*` UUIDs reserved — no uninstall button.

**Known packaging risks (v1):**
- `node_modules` in Tauri resources — pinned + N-API ABI CI verification
- `nircmd.exe` on Windows — may trigger antivirus; documented in release notes
- macOS notarization: `.node` and `.exe` in resource dir, not `Frameworks/` — verify at first release build

### Resource layout

```
src-tauri/plugins/
  com.pannacotta.system.sdPlugin/
    manifest.json  (UUID: "com.pannacotta.system")
    bin/plugin.js
    node_modules/loudness/prebuilds/{platform}/loudness.node  (N-API v8)
    node_modules/brightness/
    node_modules/nircmd/nircmd.exe  (Windows)
  com.pannacotta.browser.sdPlugin/
    manifest.json  (UUID: "com.pannacotta.browser")
    bin/plugin.js
```

### System actions

| Action | Implementation | Settings |
|---|---|---|
| `run-command` | `child_process` | `{ "command": "..." }` |
| `open-app` | `open` (sindresorhus) | `{ "appName": "..." }` |
| `volume-up/down/mute/set-volume` | `loudness` | step or level |
| `brightness-up/down` | `brightness` | `{ "step": 0.1 }` |
| `sleep` | platform switch | `{}` |
| `lock` | platform switch | `{}` |

```typescript
// Correct macOS lock (CGSession -suspend, not ScreenSaverEngine)
const lock = () => ({
  darwin: () => run('/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend'),
  win32:  () => run('rundll32.exe user32.dll,LockWorkStation'),
  linux:  () => run('loginctl lock-session'),
}[process.platform as string]?.())
```

Linux caveats: X11 + systemd + logind required. Wayland v1 not supported.

### Phase plan

- **Phase 1:** Plugin system + built-in plugins. `/api/execute` accepts `{ context }`
  from LAN; legacy `{ action, target }` from localhost + CSRF. LAN frontend sends
  `{ context }`. `/api/open-app` and `/api/open-url` moved to localhost+CSRF.
  `execute_command` Rust fallback kept for localhost legacy.
- **Phase 2:** Real `@elgato/streamdeck` SDK plugin + PI tested end-to-end.
  `execute_command` Rust fallback removed.
- **Phase 3:** Legacy `{ action, target }` server support removed.

---

## 7. Node.js Runtime — Lazy Download

Resolution:
1. `{config_dir}/runtime/{platform_node}` if exists + version ≥ v20
2. System `node` ≥ v20
3. Err → emit Tauri event "node-runtime-needed"

Platform paths: macOS/Linux `bin/node` + `bin/npm`; Windows `node.exe` + `npm.cmd`.

Download: `.tar.gz` (macOS/Linux) or `.zip` (Windows) from `nodejs.org/dist`. TLS
required (no HTTP fallback). SHA256 against `SHASUMS256.txt` (download `SHASUMS256.txt`
separately, verify TLS). Extract into a `.tmp` directory; on checksum and executable
validation, atomically rename to final path. On failure or cancel, delete `.tmp`
directory. Progress via Tauri channel. Cancel supported.

**Pin:** Exact Node.js patch version (e.g., `v22.14.0`) with known-good SHA256 checksums
hardcoded in source. `SHASUMS256.txt` is used for verification but the expected checksum
is also bundled — trust-on-first-use of `SHASUMS256.txt` alone is not sufficient.

---

## 8. Admin UI & LAN Frontend Changes

### Frontend stack

**React + TypeScript** (`packages/desktop/src/`). All new components are `.tsx`.

### New React components

- `ActionPicker.tsx`
- `PropertyInspector.tsx`
- `NodeRuntimeDialog.tsx`

### Existing components (updated)

- `ButtonEditor.tsx` → `ActionPicker` + `PropertyInspector`
- `ActionSidebar.tsx` → source from `GET /api/plugins`
- `PannaApp.tsx` → plugin install panel + `NodeRuntimeDialog`

### Property Inspector iframe

```tsx
<iframe
  src={`http://127.0.0.1:${port}/pi/${pluginUUID}/${relativePI}?__panna_pi=1`}
  sandbox="allow-scripts allow-forms allow-same-origin"
  title="Plugin settings"
/>
```

PI receives redacted `/api/config` (no CSRF → no `settings`).
PI cannot call Tauri commands (Tauri iframe boundary).
PI cannot trigger `/api/execute` (localhost call requires CSRF; PI has none).

**PI registration bridge** injected before `</body>` in `text/html` PI responses:

```js
// Server injects: const PI_TOKEN = '{per-request-32-byte-hex}';
window.connectElgatoStreamDeckSocket = function(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
  const ws = new WebSocket(`ws://127.0.0.1:${inPort}/ws?token=${PI_TOKEN}`);
  ws.onopen = () => ws.send(JSON.stringify({
    event: inRegisterEvent,
    uuid: inUUID,
    actionInfo: typeof inActionInfo === 'string' ? JSON.parse(inActionInfo) : inActionInfo
  }));
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    window.dispatchEvent(new MessageEvent(msg.event || 'message', { data: e.data }));
  };
};
```

`PI_TOKEN` generated per HTML response, stored in `PluginHost.pi_token_map`, consumed on
`registerPropertyInspector`. Never in iframe URL or headers.

**PI bridge must be empirically tested against real `@elgato/streamdeck` SDK PI code
before Phase 2 sign-off.**

If no `PropertyInspectorPath`: schema-driven key/value form from `settings` JSON.

### LAN frontend (`packages/frontend/app.js`) — updated in Phase 1

- Reads `button.context` from GET /api/config
- Sends `POST /api/execute { context: button.context }` only

---

## 9. Observability

Plugin logs: `~/.panna-cotta/logs/{pluginUUID}.log` (1MB rotate, 3 gens).
Host events: `~/.panna-cotta/logs/host.log`.
Admin UI plugin status panel: last 100 log lines (CSRF only), unsupported events
(deduplicated), crash count, "⚠ settings not persisted to disk" when flag is set.

---

## 10. Package Structure

```
packages/
  desktop/
    src/
      components/
        ActionPicker.tsx          ← new
        PropertyInspector.tsx     ← new
        NodeRuntimeDialog.tsx     ← new
        ButtonEditor.tsx          ← modified
        ActionSidebar.tsx         ← modified
        PannaApp.tsx              ← modified
      lib/
        types.ts                  ← Button type updated
        invoke.ts                 ← plugin Tauri commands added
    src-tauri/
      plugins/                    ← Tauri resource dir (built-in plugins)
      src/
        plugin/mod.rs             ← PluginHost, spawn, lifecycle, shutdown
        plugin/manifest.rs        ← manifest.json parser + validation
        plugin/runtime.rs         ← Node.js binary resolution + download
        events/inbound.rs         ← plugin→host handlers
        events/outbound.rs        ← host→plugin senders
        events/frontend.rs        ← host→React Tauri event bridge
        server/routes.rs          ← /ws, /pi/*, /api/plugins, /api/execute updated
        server/state.rs           ← Button updated; extension-aware profile ops
        server/mod.rs             ← into_make_service_with_connect_info
        commands/config.rs        ← delegates to PluginHost profile_state
        commands/system.rs        ← execute_command kept (Phase 1-2); open_url + URL validation
        commands/server_info.rs   ← unchanged
        commands/plugins.rs       ← new Tauri commands
  plugins/
    com.pannacotta.system/        ← plugin TypeScript source
    com.pannacotta.browser/       ← plugin TypeScript source
  frontend/
    app.js                        ← updated (context execute only)
```

### New Cargo dependencies

```toml
semver = "1"
reqwest = { version = "0.12", features = ["stream"] }
sha2 = "0.10"
tar = "0.4"
flate2 = "1"
zip = "2"
libc = "0.2"   # Unix: killpg, process_group
url = "2"      # URL parsing for openUrl scheme validation
rand = "0.8"   # 32-byte hex token generation (CSRF, PI tokens, spawn tokens)
nanoid = "0.4" # 12-char context IDs
# axum = { ..., features = ["ws"] }  ← add "ws" to existing axum dep

# Windows-only: Job Object for process group cleanup
[target.'cfg(windows)'.dependencies]
winapi = { version = "0.3", features = ["winbase", "jobapi2", "handleapi", "processthreadsapi"] }
```

---

## 11. Testing Plan

| Test | Layer |
|---|---|
| Migration mapping for all button types | `state.rs` unit |
| Migration idempotency; partial failure leaves TOML intact | `state.rs` unit |
| Extension-aware `profile_path` (JSON wins, `.json.tmp` ignored) | `state.rs` unit |
| Context ID collision detection + regeneration | `plugin/mod.rs` unit |
| Manifest hard-block cases (missing UUID, bad CodePath, OS mismatch, etc.) | `manifest.rs` unit |
| Node binary path resolution per platform | `runtime.rs` unit |
| Archive extraction: reject abs paths, `..`, symlinks, hardlinks, device nodes, FIFOs | `runtime.rs` unit |
| PI path traversal rejection | `routes.rs` unit |
| Localhost middleware rejects non-loopback ConnectInfo for admin routes | `routes.rs` unit |
| CSRF required for mutating admin routes from localhost | `routes.rs` unit |
| `/ws` reachable from localhost without CSRF; rejected from non-localhost | `routes.rs` unit |
| `/ws` plugin: no-Origin connection with valid UUID+timing accepted | `routes.rs` unit |
| `/ws` PI: Origin=127.0.0.1:N + valid PI token accepted | `routes.rs` unit |
| `/ws` browser: unexpected Origin rejected | `routes.rs` unit |
| `/api/execute` from LAN: `{ context }` accepted; legacy form rejected | `routes.rs` unit |
| `/api/execute` from LAN: `lan_allowed=false` button returns 403 | `routes.rs` unit |
| `/api/execute` context for `open-url` button: settings.url validated before OS open | integration |
| `/api/execute` from localhost: CSRF required | `routes.rs` unit |
| `/api/execute` from localhost: PI cannot call (no CSRF path) | `routes.rs` unit |
| `/api/open-app` and `/api/open-url` rejected from LAN | `routes.rs` unit |
| `/api/config` GET: settings redacted when no CSRF | `routes.rs` unit |
| `/api/plugins/:uuid/status` omits logTail without CSRF | `routes.rs` unit |
| openUrl: valid https/http URL accepted; file/javascript/custom rejected | `routes.rs` unit |
| openUrl: scheme validation uses URL parser, not string prefix | `routes.rs` unit |
| Plugin UUID-timing: valid UUID within 10s, no Origin → accepted | integration |
| Plugin UUID-timing: unknown UUID rejected | integration |
| Plugin UUID-timing: expired (>10s) rejected | integration |
| Plugin UUID-timing: duplicate UUID → first wins | integration |
| PI token: generated on HTML serve, consumed on registerPropertyInspector | integration |
| PI token: reuse rejected | integration |
| setSettings: concurrent calls serialize (no out-of-order disk writes) | integration |
| setSettings: disk failure sets settings_not_persisted flag | integration |
| setSettings: stale context after profile switch ignored | integration |
| setSettings: profile activation and setSettings do not interleave | integration |
| Legacy execute: action+target both match → executed | integration |
| Legacy execute: action matches, target does not → 403 | integration |
| Legacy execute: run-command rejected | integration |
| New `{ context }` execute routes correctly | integration |
| Profile switch → willDisappear + willAppear + queue cleared | integration |
| Crash → backoff → errored state | integration |
| Process child taken from map before kill/wait (no lock held across await) | integration |
| Process group kill terminates grandchildren (Unix) | integration |
| Startup sequence: migration completes before server starts; plugins spawn after WS live | integration |
| PI iframe cannot invoke `get_csrf_token` Tauri command | manual QA |
| PI iframe cannot invoke any other privileged Tauri command | manual QA |
| run-command button ⚠ + LAN warning shown in admin UI | manual QA |
| Real `@elgato/streamdeck` SDK plugin: keyDown roundtrip with unmodified plugin | manual QA |
| PI bridge compatibility with real SDK PI code | manual QA (Phase 2) |
| Node.js download dialog progress + cancel | manual QA |
| Plugin using `setImage` shows unsupported event warning in admin UI | manual QA |
| nircmd.exe brightness on Windows: verify antivirus behavior | manual QA |

---

## Out of Scope

- `setImage` / `setState` / global settings
- Binary/native/HTML-only plugins
- Wine / Windows `.exe` plugins
- Plugin marketplace UI
- Multi-device support
- Multi-page buttons
- Proxy for Node download
- `dial*` / `touchTap` / `setFeedback`
- Plugin code signing
- Wayland brightness on Linux
- macOS notarization verification (deferred)
- LAN phone authentication / pairing

---

## Migration Checklist

- [ ] `tauri.conf.json`: set non-null CSP; review `withGlobalTauri`
- [ ] `capabilities/default.json`: scope `get_csrf_token` to admin window origin only
- [ ] `state.rs`: `Button` struct (with `lan_allowed`); extension-aware profile ops; `.json.tmp` cleanup
- [ ] `server/mod.rs`: `into_make_service_with_connect_info`; use `tokio::process::Command` for plugins
- [ ] `AppState`: add `csrf_token: String` and `plugin_host: Arc<tokio::sync::Mutex<PluginHost>>`
- [ ] Startup sequence: migrate → load → PluginHost → server → spawn plugins
- [ ] Middleware: CSRF for admin routes; `/ws` and `/pi/*` excluded; localhost-only via ConnectInfo
- [ ] `/ws` handler: Phase A (ConnectInfo + Origin check); Phase B (first message auth: UUID-timing for plugins, PI token for PI); 5s auth timer
- [ ] `/pi/*` handler: localhost-only; path safety; PI bridge injection; PI token stored in `PluginHost.pi_token_map` (token→plugin_uuid)
- [ ] `/api/execute`: LAN → `{ context }` only + `lan_allowed` check (all actions LAN-triggerable by default; `lan_allowed=false` blocks); localhost → CSRF required; legacy validation table; `run-command` shows ⚠ in admin UI but follows same `lan_allowed` rule
- [ ] `/api/open-app` and `/api/open-url`: localhost+CSRF; URL-parser validation on both HTTP and Tauri paths
- [ ] `/api/config` GET: redact settings when CSRF absent
- [ ] `/api/plugins/:uuid/status`: logTail + settings_not_persisted gated on CSRF
- [ ] `PluginState.settings_not_persisted`: set on disk failure; admin UI shows warning
- [ ] Locking contract: no process await inside lock; consistent lock order; take `tokio::process::Child` before kill
- [ ] `plugin/mod.rs`: spawn lifecycle; `pending_registrations`; process group (Unix) / Job Object (Windows)
- [ ] `plugin/manifest.rs`: parsing + validation; UUID case-normalize for dedup
- [ ] `plugin/runtime.rs`: binary resolution + download into `.tmp` dir + archive extraction safety (hardlinks/devices/FIFOs) + atomic rename on success
- [ ] `events/`: inbound, outbound, frontend bridge
- [ ] `openUrl` event: URL-parser scheme whitelist applied on both WS event and Tauri command paths
- [ ] `frontend/app.js`: send `{ context }` only
- [ ] `ActionPicker.tsx`, `PropertyInspector.tsx`, `NodeRuntimeDialog.tsx`
- [ ] Update `ButtonEditor.tsx` (lan_allowed toggle for run-command) and `ActionSidebar.tsx`
- [ ] Phase 2: PI bridge QA with real `@elgato/streamdeck` PI
- [ ] Phase 2: remove `execute_command` Rust fallback
- [ ] Phase 3: remove legacy `{ action, target }` server support
