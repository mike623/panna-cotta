import { test, expect } from '../fixtures/fixtures'
import { defaultStore, configWith, backendButton } from '../fixtures/tauriMock'
import { installTauriMock, getStore, getCallsFor } from '../fixtures/tauriMock'

/**
 * REGRESSION: onInspectorDuplicate was shallow-cloning slot data including
 * the `context` field. Two slots sharing a context caused plugin events to
 * route to both, and FLIP animation keys to collide. The fix strips context
 * on duplicate so profileToBackend assigns a fresh one.
 */
test.describe('regression: slot duplication generates fresh contexts', () => {
  test('duplicating a filled slot yields two slots with distinct contexts', async ({ page }) => {
    const store = defaultStore()
    store.configs['Default'] = configWith([
      null, null, null,
      backendButton({
        actionUUID: 'com.pannacotta.system.open-app',
        name: '1Password',
        icon: 'app',
        context: 'STABLE-CTX-X',
        settings: { appName: '1Password' },
      }),
    ])
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()

    // Select slot 4 (index 3) — the seeded button
    await page.locator('[data-testid="slot-3"]').click()
    await expect(page.locator('[data-testid="inspector-header"]')).toContainText('Slot 4')

    // Click duplicate
    await page.locator('[data-testid="inspector-duplicate"]').click()

    // Wait for autosave to flush (debounce 600ms)
    await page.waitForFunction(() => {
      const calls = (window as any).__pannaCalls as Array<{ cmd: string }> | undefined
      return !!calls?.some(c => c.cmd === 'save_config')
    }, { timeout: 3000 })
    // Give the debouncer a touch longer so the final save lands
    await page.waitForTimeout(800)

    const backend = await getStore(page)
    const cfg = backend.configs[backend.active]
    const realButtons = cfg.buttons.filter(b => b.actionUUID !== 'com.pannacotta.empty')

    // Should be two real buttons now
    expect(realButtons.length).toBeGreaterThanOrEqual(2)

    // Critical assertion: all contexts unique (no collision)
    const ctxs = realButtons.map(b => b.context)
    expect(new Set(ctxs).size).toBe(ctxs.length)

    // Original slot still has its stable context preserved
    expect(realButtons.some(b => b.context === 'STABLE-CTX-X')).toBe(true)
  })

  test('editing the duplicate does not modify the source slot', async ({ page }) => {
    const store = defaultStore()
    store.configs['Default'] = configWith([
      backendButton({
        actionUUID: 'com.pannacotta.browser.open-url',
        name: 'Source',
        icon: 'globe',
        context: 'SOURCE-CTX',
        settings: { url: 'https://source.example' },
      }),
    ])
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()

    // Open the source slot and duplicate
    await page.locator('[data-testid="slot-0"]').click()
    await page.locator('[data-testid="inspector-duplicate"]').click()

    // Wait for a filled second slot to appear (duplicate goes to first empty)
    await expect(page.locator('[data-testid="slot-1"][data-filled="true"]')).toBeVisible()

    // Wait for the duplicate save to land before further edits, so we can
    // distinguish "duplicate-only" save from "duplicate + label edit" save.
    await page.waitForFunction(() => {
      const calls = (window as any).__pannaCalls as Array<{ cmd: string }> | undefined
      return (calls?.filter(c => c.cmd === 'save_config').length ?? 0) >= 1
    }, { timeout: 3000 })

    // Click the duplicated slot and rename it. Wait for Inspector to reflect
    // Slot 2 (1-indexed) before typing — Inspector has a useEffect that
    // re-initialises `local` when slot/slotIdx changes; typing into a stale
    // local state would re-attach the source slot's context.
    await page.locator('[data-testid="slot-1"]').click()
    await expect(page.locator('[data-testid="inspector-header"]')).toContainText('Slot 2')
    // Wait until Inspector reflects the duplicated slot's label (clone of source)
    await expect(page.locator('[data-testid="inspector-label"]')).toHaveValue('Source')
    await page.locator('[data-testid="inspector-label"]').fill('Renamed Dup')

    // Wait for the next save to flush — final state must reflect the rename
    await page.waitForFunction(() => {
      const calls = (window as any).__pannaCalls as Array<{ cmd: string; args: any }> | undefined
      const lastSave = [...(calls ?? [])].reverse().find(c => c.cmd === 'save_config')
      if (!lastSave) return false
      const buttons = (lastSave.args?.config?.buttons ?? []) as Array<{ name: string; actionUUID: string }>
      return buttons.some(b => b.name === 'Renamed Dup')
    }, { timeout: 5000 })

    const saves = await getCallsFor(page, 'save_config')
    const last = saves[saves.length - 1].args as { config: { buttons: any[] } }
    const real = last.config.buttons.filter(b => b.actionUUID !== 'com.pannacotta.empty')

    // Source unchanged
    const source = real.find(b => b.context === 'SOURCE-CTX')
    expect(source).toBeDefined()
    expect(source!.name).toBe('Source')
    // Duplicate renamed (and has a different context)
    const dup = real.find(b => b.context !== 'SOURCE-CTX')
    expect(dup).toBeDefined()
    expect(dup!.name).toBe('Renamed Dup')
  })
})
