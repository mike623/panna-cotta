import { test as base, expect } from '@playwright/test'
import { installTauriMock, defaultStore } from './tauriMock'
import type { MockStore } from './tauriMock'

/**
 * Playwright fixture that installs the Tauri mock with a fresh default
 * store before each test. Use `withStore({...})` to override.
 */
export const test = base.extend<{
  mockedPage: import('@playwright/test').Page
  storeFactory: () => MockStore
}>({
  storeFactory: async ({}, use) => {
    await use(defaultStore)
  },
  mockedPage: async ({ page, storeFactory }, use) => {
    await installTauriMock(page, storeFactory())
    await use(page)
  },
})

export { expect }
export { defaultStore, installTauriMock } from './tauriMock'
export type { MockStore, BackendConfig, BackendButton, BackendProfile } from './tauriMock'
