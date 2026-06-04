import { test, expect } from '../fixtures/fixtures'
import { getCallsFor } from '../fixtures/tauriMock'

async function dndDrag(page: import('@playwright/test').Page, fromSel: string, toSel: string) {
  await page.evaluate(({ from, to }: { from: string; to: string }) => {
    const src = document.querySelector(from)
    const dst = document.querySelector(to)
    if (!src || !dst) throw new Error(`drag targets not found: ${from} -> ${to}`)
    const dt = new DataTransfer()
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
    dst.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
    dst.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt }))
    dst.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true, dataTransfer: dt }))
    src.dispatchEvent(new DragEvent('dragend',   { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, { from: fromSel, to: toSel })
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
