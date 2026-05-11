/**
 * In-page Tauri mock. Injected via Playwright's `addInitScript` before the
 * React SPA boots so `@tauri-apps/api/core` `invoke()` resolves against an
 * in-memory store rather than the real IPC bridge.
 *
 * The handler map MUST cover every command the React code path can issue —
 * an unmocked invoke throws and the app crashes during load.
 *
 * Test observability:
 *   - `window.__pannaStore` exposes the live store (mutated by handlers).
 *   - `window.__pannaCalls` is an array of `{ cmd, args, ts }` entries —
 *     tests assert on call shape/order.
 */
import type { Page } from '@playwright/test'

export interface BackendButton {
  name: string
  icon: string
  actionUUID: string
  context: string
  settings: Record<string, unknown>
  lanAllowed?: boolean | null
}

export interface BackendConfig {
  grid: { rows: number; cols: number }
  buttons: BackendButton[]
}

export interface BackendProfile {
  name: string
  isActive: boolean
}

export interface PluginActionInfo {
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
  actions: PluginActionInfo[]
}

export interface MockStore {
  profiles: BackendProfile[]
  configs: Record<string, BackendConfig>
  active: string
  serverInfo: { ip: string; port: number }
  autostart: boolean
  appVersion: string
  csrfToken: string
  installedApps: string[]
  plugins: PluginInfo[]
  pluginRender: {
    images: Record<string, string>
    titles: Record<string, string>
    states: Record<string, number>
  }
}

const empty = (idx: number): BackendButton => ({
  name: '',
  icon: '',
  actionUUID: 'com.pannacotta.empty',
  context: `empty-${idx}`,
  settings: {},
})

export function emptyConfig(rows = 3, cols = 3): BackendConfig {
  const total = rows * cols
  return {
    grid: { rows, cols },
    buttons: Array.from({ length: total }, (_, i) => empty(i)),
  }
}

export function defaultStore(): MockStore {
  return {
    profiles: [{ name: 'Default', isActive: true }],
    configs: { Default: emptyConfig(3, 3) },
    active: 'Default',
    serverInfo: { ip: '127.0.0.1', port: 30000 },
    autostart: false,
    appVersion: '0.0.0-test',
    csrfToken: 'test-csrf-token',
    installedApps: ['Calculator', '1Password', 'Safari', 'Mail', 'Calendar'],
    plugins: [],
    pluginRender: { images: {}, titles: {}, states: {} },
  }
}

declare global {
  interface Window {
    __pannaStore?: MockStore
    __pannaCalls?: Array<{ cmd: string; args: unknown; ts: number }>
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: unknown) => Promise<unknown>
      transformCallback: () => number
    }
  }
}

/**
 * Inject the mock. Must be called before page.goto(). The init script runs
 * in every frame before any other script — so React sees the mock before
 * `import { invoke } from '@tauri-apps/api/core'` resolves.
 */
export async function installTauriMock(page: Page, initial: MockStore = defaultStore()) {
  await page.addInitScript((init: MockStore) => {
    // Deep clone so each test has a private mutable copy.
    const store: MockStore = JSON.parse(JSON.stringify(init))
    const calls: Array<{ cmd: string; args: unknown; ts: number }> = []
    ;(window as any).__pannaStore = store
    ;(window as any).__pannaCalls = calls

    const empty = (idx: number) => ({
      name: '',
      icon: '',
      actionUUID: 'com.pannacotta.empty',
      context: `empty-${idx}`,
      settings: {},
    })

    const ensureConfig = (name: string) => {
      if (!store.configs[name]) {
        const total = 9
        store.configs[name] = {
          grid: { rows: 3, cols: 3 },
          buttons: Array.from({ length: total }, (_, i) => empty(i)),
        }
      }
      return store.configs[name]
    }

    type Handler = (args: any) => any

    const handlers: Record<string, Handler> = {
      // ── Config ──────────────────────────────────────────────────────────
      get_config: () => ensureConfig(store.active),
      save_config: ({ config }: { config: any }) => {
        store.configs[store.active] = JSON.parse(JSON.stringify(config))
        return null
      },
      get_default_config: () => ({
        grid: { rows: 3, cols: 3 },
        buttons: Array.from({ length: 9 }, (_, i) => empty(i)),
      }),

      // ── Profiles ────────────────────────────────────────────────────────
      list_profiles_cmd: () => store.profiles,
      create_profile_cmd: ({ name }: { name: string }) => {
        if (store.profiles.some(p => p.name === name)) {
          throw new Error(`Profile already exists: ${name}`)
        }
        store.profiles.push({ name, isActive: false })
        ensureConfig(name)
        return null
      },
      activate_profile_cmd: ({ name }: { name: string }) => {
        if (!store.profiles.some(p => p.name === name)) {
          throw new Error(`Unknown profile: ${name}`)
        }
        store.profiles = store.profiles.map(p => ({ ...p, isActive: p.name === name }))
        store.active = name
        ensureConfig(name)
        return null
      },
      rename_profile_cmd: ({ oldName, newName }: { oldName: string; newName: string }) => {
        const idx = store.profiles.findIndex(p => p.name === oldName)
        if (idx < 0) throw new Error(`Unknown profile: ${oldName}`)
        if (store.profiles.some(p => p.name === newName)) {
          throw new Error(`Profile already exists: ${newName}`)
        }
        store.profiles[idx] = { ...store.profiles[idx], name: newName }
        store.configs[newName] = store.configs[oldName]
        delete store.configs[oldName]
        if (store.active === oldName) store.active = newName
        return null
      },
      delete_profile_cmd: ({ name }: { name: string }) => {
        if (store.profiles.length <= 1) {
          throw new Error('Cannot delete the last profile')
        }
        store.profiles = store.profiles.filter(p => p.name !== name)
        delete store.configs[name]
        if (store.active === name) {
          store.active = store.profiles[0].name
          store.profiles[0].isActive = true
        }
        return null
      },

      // ── System / commands ───────────────────────────────────────────────
      execute_command: () => null,
      open_app: () => null,
      open_url: () => null,
      open_config_folder: () => null,
      open_log_folder: () => null,
      list_installed_apps: () => store.installedApps,
      quit_app: () => null,

      // ── Server info / CSRF ──────────────────────────────────────────────
      get_server_info: () => store.serverInfo,
      get_csrf_token: () => store.csrfToken,

      // ── Autostart ───────────────────────────────────────────────────────
      get_autostart: () => store.autostart,
      set_autostart: ({ enabled }: { enabled: boolean }) => {
        store.autostart = !!enabled
        return null
      },

      // ── Version ─────────────────────────────────────────────────────────
      get_app_version: () => store.appVersion,

      // ── Plugins ─────────────────────────────────────────────────────────
      list_plugins_cmd: () => store.plugins,
      get_plugin_render: () => store.pluginRender,
    }

    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: unknown) => {
        calls.push({ cmd, args: args ? JSON.parse(JSON.stringify(args)) : null, ts: Date.now() })
        const h = handlers[cmd]
        if (!h) {
          // Loudly surface holes — tests should fail fast on unmocked commands.
          // eslint-disable-next-line no-console
          console.error(`[tauriMock] Unmocked invoke: ${cmd}`, args)
          throw new Error(`Unmocked Tauri command: ${cmd}`)
        }
        return h(args ?? {})
      },
      transformCallback: () => 0,
    }
  }, initial)
}

/** Snapshot the store from the page context. */
export async function getStore(page: Page): Promise<MockStore> {
  return await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__pannaStore)))
}

/** Get the full invoke call log. */
export async function getCalls(page: Page): Promise<Array<{ cmd: string; args: unknown; ts: number }>> {
  return await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__pannaCalls ?? [])))
}

/** Get all calls for a specific command. */
export async function getCallsFor(page: Page, cmd: string): Promise<Array<{ cmd: string; args: unknown; ts: number }>> {
  return (await getCalls(page)).filter(c => c.cmd === cmd)
}

/** Reset the call log in place — splices the existing array so the
 * closure inside the injected invoke handler keeps pointing at the live
 * log (assigning a new array would orphan the handler's reference). */
export async function clearCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const arr = (window as any).__pannaCalls as Array<unknown> | undefined
    if (arr) arr.length = 0
  })
}

/** Helpers to produce backend-shaped fixtures. */
export function backendButton(opts: Partial<BackendButton> & { actionUUID: string }): BackendButton {
  return {
    name: opts.name ?? '',
    icon: opts.icon ?? '',
    actionUUID: opts.actionUUID,
    context: opts.context ?? Math.random().toString(36).slice(2, 14),
    settings: opts.settings ?? {},
    lanAllowed: opts.lanAllowed,
  }
}

export function configWith(buttons: Array<BackendButton | null>, rows = 3, cols = 3): BackendConfig {
  const total = rows * cols
  const out: BackendButton[] = []
  for (let i = 0; i < total; i++) {
    const b = buttons[i]
    out.push(b ?? {
      name: '',
      icon: '',
      actionUUID: 'com.pannacotta.empty',
      context: `empty-${i}`,
      settings: {},
    })
  }
  return { grid: { rows, cols }, buttons: out }
}
