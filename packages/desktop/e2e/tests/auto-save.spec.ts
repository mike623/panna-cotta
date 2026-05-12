import { test, expect } from '../fixtures/fixtures'
import { getCallsFor, clearCalls } from '../fixtures/tauriMock'

test.describe('auto-save: debounced save_config', () => {
  test('a single edit fires exactly one save_config after debounce', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    // After load, ignore the initial save and clear the call log
    await mockedPage.waitForFunction(() => {
      const calls = (window as any).__pannaCalls as Array<{ cmd: string }> | undefined
      return !!calls?.some(c => c.cmd === 'save_config')
    }, { timeout: 3000 })
    await clearCalls(mockedPage)

    await mockedPage.locator('[data-testid="template-t-github"]').click()

    // Wait for the debounced save to land — give 1s to be safe past the 600ms debounce
    await mockedPage.waitForFunction(() => {
      const calls = (window as any).__pannaCalls as Array<{ cmd: string }> | undefined
      return !!calls?.some(c => c.cmd === 'save_config')
    }, { timeout: 3000 })

    // Pause one full debounce + buffer to ensure no extra save sneaks in
    await mockedPage.waitForTimeout(900)

    const saves = await getCallsFor(mockedPage, 'save_config')
    expect(saves).toHaveLength(1)
  })

  test('rapid sequential edits within debounce window collapse to one save', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    // Clear initial saves
    await mockedPage.waitForFunction(() => {
      const calls = (window as any).__pannaCalls as Array<{ cmd: string }> | undefined
      return !!calls?.some(c => c.cmd === 'save_config')
    }, { timeout: 3000 })
    await clearCalls(mockedPage)

    // Open inspector for slot 1 and make 3 rapid edits to the label
    await mockedPage.locator('[data-testid="slot-0"]').click()
    const label = mockedPage.locator('[data-testid="inspector-label"]')
    // type three letters back-to-back; each keypress mutates state
    await label.fill('A')
    await mockedPage.waitForTimeout(100)
    await label.fill('AB')
    await mockedPage.waitForTimeout(100)
    await label.fill('ABC')
    // Total elapsed < debounce window (600ms) so far

    // Now wait past the debounce
    await mockedPage.waitForTimeout(1200)

    const saves = await getCallsFor(mockedPage, 'save_config')
    expect(saves).toHaveLength(1)
    const last = saves[saves.length - 1].args as { config: { buttons: any[] } }
    // The single save must reflect the FINAL state ("ABC")
    expect(last.config.buttons[0].name).toBe('ABC')
  })
})
