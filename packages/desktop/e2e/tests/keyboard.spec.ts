import { test, expect } from '../fixtures/fixtures'
import { defaultStore, configWith, backendButton, installTauriMock } from '../fixtures/tauriMock'

test.describe('keyboard shortcuts', () => {
  test('pressing "1" selects slot 1', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await mockedPage.keyboard.press('1')
    await expect(mockedPage.locator('[data-testid="inspector-header"]')).toContainText('Slot 1')
  })

  test('pressing Escape closes inspector and deselects', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await mockedPage.locator('[data-testid="slot-0"]').click()
    await expect(mockedPage.locator('[data-testid="inspector"]')).toBeVisible()

    await mockedPage.keyboard.press('Escape')
    await expect(mockedPage.locator('[data-testid="inspector"]')).toHaveCount(0)
  })

  test('pressing Delete clears the selected slot', async ({ page }) => {
    const store = defaultStore()
    store.configs['Default'] = configWith([
      backendButton({ actionUUID: 'com.pannacotta.media.play', name: 'Play', context: 'P1', settings: {} }),
    ])
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()
    await expect(page.locator('[data-testid="slot-0"][data-filled="true"]')).toBeVisible()

    // Select slot 1 via keyboard shortcut "1"
    await page.keyboard.press('1')
    await expect(page.locator('[data-testid="inspector-header"]')).toContainText('Slot 1')

    // Delete clears it
    await page.keyboard.press('Delete')
    await expect(page.locator('[data-testid="slot-0"][data-filled="false"]')).toBeVisible()
  })

  test('pressing "?" toggles the shortcuts overlay', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()
    await expect(mockedPage.locator('[data-testid="shortcuts-overlay"]')).toHaveCount(0)

    // Playwright's `keyboard.press('?')` synthesises a KeyboardEvent with key='?'
    // (no need for Shift+/ — that emits key='/' with shiftKey set, which doesn't
    // match the React handler's `e.key === '?'` check).
    await mockedPage.keyboard.press('?')
    await expect(mockedPage.locator('[data-testid="shortcuts-overlay"]')).toBeVisible()

    await mockedPage.keyboard.press('Escape')
    await expect(mockedPage.locator('[data-testid="shortcuts-overlay"]')).toHaveCount(0)
  })
})
