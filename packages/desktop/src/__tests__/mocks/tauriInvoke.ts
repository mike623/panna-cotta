import { vi } from 'vitest'

/**
 * Default stubbed responses for every Tauri command exposed via lib/invoke.ts.
 *
 * Individual tests can `vi.mock('../../lib/invoke', () => ({ ...buildInvokeMock(overrides) }))`
 * or call factory helpers below.
 */
export function makeInvokeMocks(overrides: Partial<Record<string, unknown>> = {}) {
  const defaults: Record<string, unknown> = {
    getConfig: { grid: { rows: 3, cols: 3 }, buttons: [] },
    saveConfig: undefined,
    getDefaultConfig: { grid: { rows: 3, cols: 3 }, buttons: [] },
    listProfiles: [{ name: 'Default', isActive: true }],
    createProfile: undefined,
    activateProfile: undefined,
    renameProfile: undefined,
    deleteProfile: undefined,
    openConfigFolder: undefined,
    executeCommand: undefined,
    openApp: undefined,
    listInstalledApps: ['Calculator', '1Password', 'Safari'],
    openUrl: undefined,
    getServerInfo: { ip: '127.0.0.1', port: 30000 },
    getCsrfToken: 'test-csrf',
    listPlugins: [],
    getPluginRender: { images: {}, titles: {}, states: {} },
    ...overrides,
  }
  const out: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const [name, value] of Object.entries(defaults)) {
    out[name] = vi.fn().mockResolvedValue(value)
  }
  return out
}
