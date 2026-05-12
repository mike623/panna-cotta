import { test, expect } from '../fixtures/fixtures'

test.describe('undo / redo: history stack', () => {
  test('three template additions can be undone then redone', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    // Three template clicks fill slots 0, 1, 2 — each click re-opens
    // the Inspector, so close before the next.
    await mockedPage.locator('[data-testid="template-t-github"]').click()
    await expect(mockedPage.locator('[data-testid="slot-0"][data-filled="true"]')).toBeVisible()
    await mockedPage.locator('[data-testid="inspector-close"]').click()

    await mockedPage.locator('[data-testid="template-t-google"]').click()
    await expect(mockedPage.locator('[data-testid="slot-1"][data-filled="true"]')).toBeVisible()
    await mockedPage.locator('[data-testid="inspector-close"]').click()

    await mockedPage.locator('[data-testid="template-t-mail"]').click()
    await expect(mockedPage.locator('[data-testid="slot-2"][data-filled="true"]')).toBeVisible()

    await expect(mockedPage.locator('[data-testid^="slot-"][data-filled="true"]')).toHaveCount(3)

    // Three undos → all three reverted
    await mockedPage.keyboard.press('Meta+z')
    await mockedPage.keyboard.press('Meta+z')
    await mockedPage.keyboard.press('Meta+z')
    await expect(mockedPage.locator('[data-testid^="slot-"][data-filled="true"]')).toHaveCount(0)

    // Three redos → all three restored
    await mockedPage.keyboard.press('Meta+Shift+z')
    await mockedPage.keyboard.press('Meta+Shift+z')
    await mockedPage.keyboard.press('Meta+Shift+z')
    await expect(mockedPage.locator('[data-testid^="slot-"][data-filled="true"]')).toHaveCount(3)
    await expect(mockedPage.locator('[data-testid="slot-0"][data-filled="true"]')).toBeVisible()
    await expect(mockedPage.locator('[data-testid="slot-1"][data-filled="true"]')).toBeVisible()
    await expect(mockedPage.locator('[data-testid="slot-2"][data-filled="true"]')).toBeVisible()
  })
})
