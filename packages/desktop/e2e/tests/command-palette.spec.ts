import { test, expect } from '../fixtures/fixtures'

test.describe('command palette: ⌘K interactions', () => {
  test('⌘K opens palette, query filters, selecting fills first empty slot', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    // Open the palette via the keyboard shortcut.
    await mockedPage.keyboard.press('Meta+k')
    await expect(mockedPage.locator('[data-testid="command-palette"]')).toBeVisible()

    // Type a query — should narrow results
    await mockedPage.locator('[data-testid="command-palette-input"]').fill('open url')

    // Results contain at least the Open URL action and nothing matching "redo"
    const items = mockedPage.locator('[data-testid^="command-item-"]')
    await expect(items.first()).toBeVisible()
    const itemTexts = await items.allTextContents()
    expect(itemTexts.some(t => t.toLowerCase().includes('open url'))).toBe(true)
    expect(itemTexts.some(t => t.toLowerCase().includes('redo'))).toBe(false)

    // Click the Open URL action item — it should populate the first empty slot
    await mockedPage.locator('[data-testid="command-item-action-open-url"]').click()

    await expect(mockedPage.locator('[data-testid="command-palette"]')).toHaveCount(0)
    await expect(mockedPage.locator('[data-testid="slot-0"][data-filled="true"]')).toBeVisible()
  })

  test('Escape closes the command palette without firing an action', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await mockedPage.keyboard.press('Meta+k')
    await expect(mockedPage.locator('[data-testid="command-palette"]')).toBeVisible()
    await mockedPage.keyboard.press('Escape')
    await expect(mockedPage.locator('[data-testid="command-palette"]')).toHaveCount(0)
    // No slots were filled
    await expect(mockedPage.locator('[data-testid^="slot-"][data-filled="true"]')).toHaveCount(0)
  })
})
