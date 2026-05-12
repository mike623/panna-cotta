import { test, expect } from '../fixtures/fixtures'
import { defaultStore, configWith, backendButton, installTauriMock, getCallsFor, getStore } from '../fixtures/tauriMock'

test.describe('profiles: create, activate, switch', () => {
  test('clicking "New profile" creates and activates a new profile', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    // Initially: only "Default" in the rail
    await expect(mockedPage.locator('text=Default').first()).toBeVisible()
    await expect(mockedPage.locator('text=Profile 2')).toHaveCount(0)

    await mockedPage.locator('text=New profile').click()

    await expect(mockedPage.locator('text=Profile 2').first()).toBeVisible()
    const calls = await getCallsFor(mockedPage, 'create_profile_cmd')
    expect(calls.length).toBeGreaterThan(0)
    expect((calls[0].args as { name: string }).name).toBe('Profile 2')
  })

  test('switching profile activates it in the backend and reloads config', async ({ page }) => {
    const store = defaultStore()
    store.profiles = [
      { name: 'Default', isActive: true },
      { name: 'Gaming', isActive: false },
    ]
    store.configs['Default'] = configWith([
      backendButton({ actionUUID: 'com.pannacotta.browser.open-url', name: 'On Default', context: 'D1', settings: { url: 'd' } }),
    ])
    store.configs['Gaming'] = configWith([
      backendButton({ actionUUID: 'com.pannacotta.media.play', name: 'Play', context: 'G1', settings: {} }),
    ])
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()
    await expect(page.locator('text=On Default')).toBeVisible()

    await page.locator('button:has-text("Gaming")').click()

    const activations = await getCallsFor(page, 'activate_profile_cmd')
    expect(activations.length).toBeGreaterThan(0)
    expect((activations[activations.length - 1].args as { name: string }).name).toBe('Gaming')

    // Verify the active profile state mutated
    const after = await getStore(page)
    expect(after.active).toBe('Gaming')
  })

  test('cannot delete the last remaining profile (mock enforces)', async ({ page }) => {
    const store = defaultStore()
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()
    // Surface-level guarantee: the mock backend rejects deletion of the last
    // profile. We invoke it directly because the React UI does not expose a
    // delete control yet.
    const err = await page.evaluate(async () => {
      try {
        await (window as any).__TAURI_INTERNALS__.invoke('delete_profile_cmd', { name: 'Default' })
        return null
      } catch (e: any) {
        return String(e?.message ?? e)
      }
    })
    expect(err).toMatch(/Cannot delete the last profile/)
  })

  test('renaming a profile via IPC mutates the backend list', async ({ page }) => {
    const store = defaultStore()
    store.profiles = [
      { name: 'Default', isActive: true },
      { name: 'OldName', isActive: false },
    ]
    store.configs['OldName'] = configWith([])
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()

    await page.evaluate(async () => {
      await (window as any).__TAURI_INTERNALS__.invoke('rename_profile_cmd', { oldName: 'OldName', newName: 'NewName' })
    })
    const after = await getStore(page)
    expect(after.profiles.find(p => p.name === 'NewName')).toBeDefined()
    expect(after.profiles.find(p => p.name === 'OldName')).toBeUndefined()
  })
})
