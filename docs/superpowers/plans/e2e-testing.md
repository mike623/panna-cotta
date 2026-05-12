# E2E Testing Plan — Panna Cotta

Comprehensive automated test coverage across 5 phases. Goal: catch regressions
like the slot-duplicate context bug before they reach disk.

**Stack:** cargo test + Vitest + React Testing Library + Playwright (mocked
Tauri) + Playwright (real Axum) + WebdriverIO/tauri-driver (smoke).

**Why not Playwright-on-Tauri directly:** `wry` webview on macOS is not a
WebDriver target. tauri-driver works on Linux/Windows only. So admin UI E2E
runs against the React SPA in headless Chromium with `window.__TAURI_INTERNALS__`
mocked.

---

## Phase 1 — Rust Backend (`cargo test`)

**State:** `packages/desktop/src-tauri/src/` already has tests in `state.rs`,
`routes.rs`. Expand:

- `state::save_stream_deck_config`
  - Write config with two buttons sharing context → on reload, dedup applied? *(currently no — defensive only in frontend; decide whether backend should also dedup)*
  - Round-trip preserves `com.pannacotta.empty` placeholders (index stability).
  - Atomic write: kill mid-write simulated via faulty fs → original file intact.
- `state::migrate_old_config`
  - JSON exists → no-op.
  - Only TOML exists → migrated to JSON, .toml.bak created.
  - Legacy single-file → split into Default.json.
  - Idempotent across 3 calls.
- `routes`
  - `GET /api/config` strips `lanAllowed: false` buttons.
  - `GET /api/config` requires no auth (LAN open).
  - `POST /api/execute` requires CSRF token, 403 without.
  - `POST /api/profiles` rejects invalid names (path traversal, empty).
  - `PATCH /api/profiles/:name` renames file atomically.
- `plugin::PluginHost`
  - `fire_profile_lifecycle` emits willDisappear for old, willAppear for new.
  - WS handshake: bad UUID → close; correct UUID + token → register event.
  - `setSettings` from PI persists to disk.
  - Plugin crash → status flips to `errored`, no zombie process.
- Property Inspector route
  - Valid token + UUID → 200 + PI HTML.
  - Token mismatch → 403.
  - Path traversal in piPath → 400.

**Target coverage:** 80%+ on `server/`, `commands/`, `plugin/`. Measure via
`cargo tarpaulin` or `cargo llvm-cov` in CI.

**Files to add:**
- `src-tauri/src/server/state_dedup_test.rs` (or extend existing tests mod)
- `src-tauri/tests/integration_axum.rs` (end-to-end Axum via `tower::ServiceExt`)
- `src-tauri/tests/plugin_lifecycle.rs`

---

## Phase 2 — React Component Tests (Vitest + RTL)

**Where:** `packages/desktop/src/__tests__/components/`

**Setup:**
```bash
npm i -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

Update `vitest.config.ts` → `environment: 'jsdom'`, `setupFiles: ['./src/__tests__/setup.ts']`.

**Tests:**

`Inspector.test.tsx`
- Renders default open-url when slot undefined.
- Type label → `onChange` fires with merged slot (label updated, other fields preserved).
- Change Type → settings auto-clear (or preserve, document choice).
- Click Duplicate → calls `onDuplicate` prop. (Real dedup tested in bridge.)
- App picker datalist appears for `open-app` when `listInstalledApps` resolves.
- Icon suggestions click → updates `iconOverride`.

`Tile.test.tsx`
- Empty slot → renders plus icon button.
- Filled slot → renders icon + label.
- Selected → accent ring shown.
- Dimmed prop → opacity reduced.
- `dragState: 'over'` → scaled.

`SlotCell.test.tsx`
- Drop indicator visible when `isOver`.
- Swap badge appears when dragging tile over filled slot (different idx).

`commit-undo.test.tsx`
- Initial state captured.
- Each `commit` appends, increments hIdx.
- Undo decrements, redo restores.
- History caps at 50 (oldest dropped).

`flip.test.tsx` (harder, may skip — pure DOM measurement)
- Mock `getBoundingClientRect` per `useRef` element.
- Reorder slots → assert `prev.left - new.left` deltas applied as `translate()`.

**Run:** `npm test`

---

## Phase 3 — Admin UI E2E (Playwright + in-memory Tauri mock)

**Where:** `packages/desktop/e2e/`

**Setup:**
```bash
npm i -D @playwright/test
npx playwright install chromium
```

`packages/desktop/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:1420', trace: 'retain-on-failure' },
})
```

### Tauri Mock (`e2e/fixtures/tauriMock.ts`)

Inject before page load via `addInitScript`. Replaces `@tauri-apps/api/core`
`invoke()` with handler map driven by a fake config store. Each test gets a
fresh store via `test.beforeEach`.

```ts
type Store = { profiles: any[]; configs: Record<string, any>; active: string }

export function installTauriMock(page: Page, initial: Store) {
  return page.addInitScript((init) => {
    const store = JSON.parse(JSON.stringify(init))
    const handlers: Record<string, (args: any) => any> = {
      list_profiles_cmd: () => store.profiles,
      get_config: () => store.configs[store.active],
      save_config: ({ config }) => { store.configs[store.active] = config },
      activate_profile_cmd: ({ name }) => { store.active = name },
      create_profile_cmd: ({ name }) => { store.profiles.push({ name, isActive: false }); store.configs[name] = { grid: {rows:3,cols:3}, buttons: [] } },
      get_server_info: () => ({ ip: '127.0.0.1', port: 30000 }),
      list_installed_apps: () => ['Calculator', '1Password', 'Safari'],
      list_plugins_cmd: () => [],
      get_plugin_render: () => ({ images: {}, titles: {}, states: {} }),
      get_autostart: () => false,
      get_app_version: () => '0.0.0-test',
    }
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        const h = handlers[cmd]
        if (!h) throw new Error(`Unmocked invoke: ${cmd}`)
        return h(args)
      },
      transformCallback: () => 0,
    }
  }, initial)
}
```

### Test Files

`e2e/tests/crud.spec.ts`
- Load → 9 empty slots visible.
- Click slot 4 → inspector opens, "SLOT 4" header.
- Select Open App → type label "GitHub" → assert state save called with slot[3] = {label:'GitHub', actionId:'open-app'}.
- Click slot 4 again → label still "GitHub" (state persisted).
- Click Clear → slot 4 empty, inspector closes.

`e2e/tests/duplicate-context.spec.ts` *(regression for this session's bug)*
- Seed: slot 4 = 1Password (context X).
- Click Duplicate → first empty slot gets clone.
- Trigger save → assert two saved buttons have **different** contexts.
- Edit duplicated slot label → original slot label unchanged.

`e2e/tests/drag-reorder.spec.ts`
- Drag slot 4 → drop on slot 1. Both swap. Save called with swapped data.
- Drag onto empty slot. Source becomes empty, destination filled.

`e2e/tests/drag-action.spec.ts`
- Drag GitHub template from palette → drop on slot 5. Slot filled with template data.
- Click template → fills first empty slot.

`e2e/tests/profile.spec.ts`
- Add profile → name input → create_profile_cmd called.
- Switch profile → get_config refetched, grid re-rendered.
- Rename profile → list updates.
- Delete profile → last profile blocked (UI disabled or error toast).

`e2e/tests/grid-resize.spec.ts`
- Default 3x3 → stepper Rows 2 → grid shows 2 rows, last 3 slots disappear from rendering but state preserved.
- Cols 4 → grid 2x4, 8 cells.

`e2e/tests/plugin-pi.spec.ts`
- Mock plugin in `list_plugins_cmd` with `piPath: 'pi/index.html'`.
- Select slot using that action → iframe rendered with correct src.
- Mock iframe postMessage → assert setSettings invoked.

`e2e/tests/undo-redo.spec.ts`
- Add 3 buttons. ⌘Z 3 times → all gone. ⌘⇧Z → restored in order.

`e2e/tests/keyboard.spec.ts`
- Press "1" → slot 1 selected.
- Press Esc → deselected, inspector closed.
- Press Delete on selected → cleared.
- Press "?" → shortcuts overlay opens.

`e2e/tests/command-palette.spec.ts`
- ⌘K → palette opens.
- Type "github" → filter results.
- Click result → first empty slot filled, palette closes.

`e2e/tests/theme-persist.spec.ts`
- Toggle dark mode. Reload. Assert localStorage `panna-tweaks` preserved.
- Toolbar reflects state.

`e2e/tests/auto-save.spec.ts`
- Make change. Wait 700ms. Assert `save_config` called exactly once with debounced state.
- Rapid edits within 600ms → only ONE save.

**Run:** `npx playwright test`

---

## Phase 4 — LAN E2E (Playwright vs real Axum)

**Where:** `packages/desktop/e2e-lan/`

**Setup:**

Boot the actual Rust binary with a temp config directory. Read port from
`~/.panna-cotta.port` (or pass `--config-dir` flag if added).

```ts
// e2e-lan/global-setup.ts
import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

export default async function globalSetup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'panna-e2e-'))
  process.env.PANNA_CONFIG_DIR = dir
  // Seed a known profile
  writeFileSync(path.join(dir, 'profiles', 'Default.json'), seedConfig)

  const proc = spawn('cargo', ['run', '--release'], {
    env: { ...process.env, PANNA_CONFIG_DIR: dir },
    stdio: 'pipe',
  })
  process.env.PANNA_PROC_PID = String(proc.pid)
  // Wait for port file (poll up to 30s)
  // ... store port in PANNA_PORT
}
```

*Note:* may need to add `PANNA_CONFIG_DIR` env var support to `AppState` in
Rust — currently config dir is hardcoded to `~/.panna-cotta`.

### Tests

`e2e-lan/tests/qr-page.spec.ts`
- GET `/` → HTML contains the LAN URL and a QR image/svg.

`e2e-lan/tests/apps-static.spec.ts`
- GET `/apps/` → returns embedded index.html.
- GET `/apps/app.js` → returns JS.
- GET `/apps/manifest.json` → PWA manifest valid.

`e2e-lan/tests/button-render.spec.ts`
- Load `/apps/`. Wait for config fetch. Assert 9 cells, correct icons + labels.

`e2e-lan/tests/execute.spec.ts`
- Tap a "Calculator" cell → POST /api/execute → mock dispatcher returns success → cell shows feedback animation.

`e2e-lan/tests/csrf.spec.ts`
- Direct POST /api/execute without CSRF header → 403.
- With valid token → 200.

`e2e-lan/tests/plugin-render.spec.ts`
- Open WS to plugin endpoint. Send `setImage` for button context. Reload `/apps/`. Cell renders custom image.

`e2e-lan/tests/lan-allowed-filter.spec.ts`
- Seed config with one button `lanAllowed: false`. GET /api/config → that button absent.

**Teardown:** kill spawned process, rm tmp dir.

**Run:** `npx playwright test --config=e2e-lan/playwright.config.ts`

---

## Phase 5 — Native Smoke (optional, Linux only)

**Where:** `packages/desktop/smoke/`

**Tool:** `tauri-driver` + WebdriverIO.

```bash
cargo install tauri-driver
npm i -D webdriverio @wdio/cli @wdio/local-runner @wdio/mocha-framework
```

`smoke/wdio.conf.ts` — points at `tauri-driver` on port 4444, capability binary path.

`smoke/specs/launch.e2e.ts`
- App launches.
- Admin window has title "Panna Cotta".
- Tray icon present (hard — may skip).
- Quit via menu → process exits clean.

**macOS:** skip in CI (tauri-driver macOS support is broken). Manual run only.
**Linux CI:** runs after Rust build.
**Windows CI:** runs after Tauri bundle.

---

## CI — GitHub Actions Matrix

`.github/workflows/test.yml`:

```yaml
name: test
on:
  pull_request:
  push:
    branches: [main]

jobs:
  rust:
    strategy:
      matrix: { os: [ubuntu-latest, macos-latest, windows-latest] }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cd packages/desktop/src-tauri && cargo test --all-features
      - run: cd packages/desktop/src-tauri && cargo clippy -- -D warnings

  vitest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: packages/desktop/package-lock.json }
      - run: cd packages/desktop && npm ci
      - run: cd packages/desktop && npm test -- --run

  playwright-admin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: packages/desktop/package-lock.json }
      - run: cd packages/desktop && npm ci
      - run: cd packages/desktop && npx playwright install --with-deps chromium
      - run: cd packages/desktop && npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: packages/desktop/playwright-report/ }

  playwright-lan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd packages/desktop && npm ci
      - run: cd packages/desktop && npm run build
      - run: cd packages/desktop/src-tauri && cargo build --release
      - run: cd packages/desktop && npx playwright install --with-deps chromium
      - run: cd packages/desktop && npx playwright test --config=e2e-lan/playwright.config.ts

  smoke-linux:
    runs-on: ubuntu-latest
    needs: [rust, vitest]
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get update && sudo apt-get install -y webkit2gtk-4.1
      - run: cargo install tauri-driver
      - uses: actions/setup-node@v4
      - run: cd packages/desktop && npm ci && npm run tauri build
      - run: cd packages/desktop && npx wdio run smoke/wdio.conf.ts
```

---

## Execution Order

| Step | Phase | Effort | Dependencies |
|------|-------|--------|--------------|
| 1 | Phase 1 expand cargo tests | 4-6h | none |
| 2 | Phase 2 RTL setup + component tests | 4-6h | none |
| 3 | Phase 3 Playwright + Tauri mock + 11 specs | 8-12h | Phase 2 patterns |
| 4 | Rust: add `PANNA_CONFIG_DIR` env support | 1-2h | Phase 1 |
| 5 | Phase 4 LAN E2E spawn + 6 specs | 6-8h | Step 4 |
| 6 | Phase 5 tauri-driver smoke (Linux) | 3-4h | none |
| 7 | CI workflow + green run | 2-3h | all above |

**Total:** ~30-40h serial. Parallelizable across phases 1+2+5 then 3+4.

---

## Coverage Targets

- Rust: 80% lines (`cargo llvm-cov`)
- Frontend logic: 90% lines (vitest --coverage, bridge/data/utils)
- Components: critical paths only (Inspector, Tile, commit/undo)
- Admin E2E: 100% of slot CRUD + drag + profile + plugin PI flows
- LAN E2E: 100% of public HTTP routes + WS auth

## Out of Scope (Document)

- Visual regression / screenshot diffing — defer until UI stabilizes.
- Cross-OS Tauri native window automation on macOS — blocked by ecosystem.
- Load/stress testing the LAN server — not a real concern for 1-10 clients.
- Marketplace plugin install end-to-end (deep-link install) — manual for now.
