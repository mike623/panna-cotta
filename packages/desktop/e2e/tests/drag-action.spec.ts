import { test, expect } from '../fixtures/fixtures'
import { getCallsFor } from '../fixtures/tauriMock'

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
  await page.mouse.move(fx + 12, fy + 12, { steps: 4 })
  await page.mouse.move(tx, ty, { steps: 10 })
  await page.waitForTimeout(50)
  await page.mouse.up()
}

test.describe('drag-and-drop: add action from palette', () => {
  test('dragging a Quick template onto a slot fills it', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await dndDrag(mockedPage, '[data-testid="template-t-github"]', '[data-testid="slot-4"]')

    await expect(mockedPage.locator('[data-testid="slot-4"][data-filled="true"]')).toBeVisible()
    // Inspector should be focused on slot 5 (1-indexed)
    await expect(mockedPage.locator('[data-testid="inspector-header"]')).toContainText('Slot 5')
  })

  test('clicking a Quick template fills the first empty slot', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await mockedPage.locator('[data-testid="template-t-google"]').click()
    await expect(mockedPage.locator('[data-testid="slot-0"][data-filled="true"]')).toBeVisible()

    // After click, Inspector replaces ActionPalette. Close inspector to bring
    // the palette back, then click the next template.
    await mockedPage.locator('[data-testid="inspector-close"]').click()
    await expect(mockedPage.locator('[data-testid="template-t-mail"]')).toBeVisible()
    await mockedPage.locator('[data-testid="template-t-mail"]').click()
    await expect(mockedPage.locator('[data-testid="slot-1"][data-filled="true"]')).toBeVisible()

    // Verify save_config eventually fires with the populated layout
    await mockedPage.waitForFunction(() => {
      const calls = (window as any).__pannaCalls as Array<{ cmd: string; args: any }> | undefined
      const lastSave = [...(calls ?? [])].reverse().find(c => c.cmd === 'save_config')
      if (!lastSave) return false
      const b = lastSave.args.config.buttons
      return b[0]?.name === 'Google' && b[1]?.name === 'Mail'
    }, { timeout: 3000 })

    const saves = await getCallsFor(mockedPage, 'save_config')
    const last = saves[saves.length - 1].args as { config: { buttons: any[] } }
    expect(last.config.buttons[0].name).toBe('Google')
    expect(last.config.buttons[1].name).toBe('Mail')
  })
})
