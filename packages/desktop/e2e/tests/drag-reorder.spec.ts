import { test, expect } from '../fixtures/fixtures'
import { defaultStore, configWith, backendButton, installTauriMock, getCallsFor } from '../fixtures/tauriMock'

/**
 * Drag-and-drop is driven by dnd-kit's PointerSensor with an 8px activation
 * distance. Playwright's high-level dragTo() doesn't always trigger pointer
 * sensors reliably, so we use manual pointer events to step over the
 * activation threshold before issuing the move/drop.
 */
async function dndDrag(page: import('@playwright/test').Page, fromSel: string, toSel: string) {
  const from = page.locator(fromSel)
  const to = page.locator(toSel)
  const fb = await from.boundingBox()
  const tb = await to.boundingBox()
  if (!fb || !tb) throw new Error('drag targets not visible')
  const fx = fb.x + fb.width / 2
  const fy = fb.y + fb.height / 2
  const tx = tb.x + tb.width / 2
  const ty = tb.y + tb.height / 2
  await page.mouse.move(fx, fy)
  await page.mouse.down()
  // Cross activation distance (8px)
  await page.mouse.move(fx + 12, fy + 12, { steps: 4 })
  // Move toward target in steps so dnd-kit emits drag-over events
  await page.mouse.move(tx, ty, { steps: 10 })
  // Pause to allow dnd-kit's drop indicator to register
  await page.waitForTimeout(50)
  await page.mouse.up()
}

test.describe('drag-and-drop: reorder tiles', () => {
  test('drag filled slot onto another filled slot swaps them', async ({ page }) => {
    const store = defaultStore()
    store.configs['Default'] = configWith([
      backendButton({ actionUUID: 'com.pannacotta.browser.open-url', name: 'First',  context: 'A', settings: { url: 'a' } }),
      null, null,
      backendButton({ actionUUID: 'com.pannacotta.browser.open-url', name: 'Fourth', context: 'D', settings: { url: 'd' } }),
    ])
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()
    await expect(page.locator('[data-testid="slot-0"][data-filled="true"]')).toBeVisible()
    await expect(page.locator('[data-testid="slot-3"][data-filled="true"]')).toBeVisible()

    await dndDrag(page, '[data-testid="slot-3"]', '[data-testid="slot-0"]')

    // Wait for autosave to land with swapped buttons
    await page.waitForFunction(() => {
      const calls = (window as any).__pannaCalls as Array<{ cmd: string; args: any }> | undefined
      const lastSave = [...(calls ?? [])].reverse().find(c => c.cmd === 'save_config')
      if (!lastSave) return false
      const b = lastSave.args.config.buttons
      return b[0]?.name === 'Fourth' && b[3]?.name === 'First'
    }, { timeout: 5000 })

    const saves = await getCallsFor(page, 'save_config')
    const last = saves[saves.length - 1].args as { config: { buttons: any[] } }
    expect(last.config.buttons[0].name).toBe('Fourth')
    expect(last.config.buttons[3].name).toBe('First')
  })

  test('drag filled slot onto an empty slot moves source', async ({ page }) => {
    const store = defaultStore()
    store.configs['Default'] = configWith([
      null, null, null,
      backendButton({ actionUUID: 'com.pannacotta.browser.open-url', name: 'Mover', context: 'M', settings: { url: 'm' } }),
    ])
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()
    await expect(page.locator('[data-testid="slot-3"][data-filled="true"]')).toBeVisible()

    await dndDrag(page, '[data-testid="slot-3"]', '[data-testid="slot-1"]')

    await page.waitForFunction(() => {
      const calls = (window as any).__pannaCalls as Array<{ cmd: string; args: any }> | undefined
      const lastSave = [...(calls ?? [])].reverse().find(c => c.cmd === 'save_config')
      if (!lastSave) return false
      const b = lastSave.args.config.buttons
      return b[1]?.name === 'Mover' && b[3]?.actionUUID === 'com.pannacotta.empty'
    }, { timeout: 5000 })
    await expect(page.locator('[data-testid="slot-1"][data-filled="true"]')).toBeVisible()
    await expect(page.locator('[data-testid="slot-3"][data-filled="false"]')).toBeVisible()
  })
})
