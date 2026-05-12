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

  // Regression: Escape must dismiss the inspector even when a text field has focus.
  // Bug: inInput guard was placed before Escape handler, swallowing Escape in inputs.
  test('pressing Escape while typing in inspector label closes inspector', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await mockedPage.locator('[data-testid="slot-2"]').click()
    await expect(mockedPage.locator('[data-testid="inspector"]')).toBeVisible()

    await mockedPage.locator('[data-testid="inspector-label"]').focus()
    await mockedPage.keyboard.press('Escape')

    await expect(mockedPage.locator('[data-testid="inspector"]')).toHaveCount(0)
  })

  // Regression: Cmd+Z inside an inspector input must not trigger app undo.
  // Bug: meta shortcuts fired before the inInput guard, so Cmd+Z in a text field
  // both suppressed browser text-undo (via preventDefault) and fired app undo.
  test('Cmd+Z inside inspector label does not undo app state', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    // Add a template to slot 1 so there is committed app state to undo.
    await mockedPage.locator('[data-testid="template-t-github"]').click()
    await expect(mockedPage.locator('[data-testid="slot-0"][data-filled="true"]')).toBeVisible()

    // Open slot 1 and type in the label field.
    await mockedPage.locator('[data-testid="slot-0"]').click()
    await expect(mockedPage.locator('[data-testid="inspector"]')).toBeVisible()
    await mockedPage.locator('[data-testid="inspector-label"]').fill('MyApp')

    // Cmd+Z while the input is focused must NOT undo the template drop.
    await mockedPage.locator('[data-testid="inspector-label"]').focus()
    await mockedPage.keyboard.press('Meta+z')

    // Slot must still be filled (app undo was NOT triggered).
    await expect(mockedPage.locator('[data-testid="slot-0"][data-filled="true"]')).toBeVisible()
  })

  // Regression: typing digits inside inspector inputs must not jump slots.
  // Bug: window keydown handler fired on all keys including those inside
  // input fields, so typing "1" in the label field switched to slot 1.
  test('typing a digit in inspector label does not change selected slot', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await mockedPage.locator('[data-testid="slot-2"]').click()
    await expect(mockedPage.locator('[data-testid="inspector-header"]')).toContainText('Slot 3')

    await mockedPage.locator('[data-testid="inspector-label"]').focus()
    await mockedPage.keyboard.press('1')

    // Slot must not have jumped to slot 1
    await expect(mockedPage.locator('[data-testid="inspector-header"]')).toContainText('Slot 3')
    // The digit must appear in the field instead
    await expect(mockedPage.locator('[data-testid="inspector-label"]')).toHaveValue('1')
  })

  test('typing a digit in inspector value does not change selected slot', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await mockedPage.locator('[data-testid="slot-2"]').click()
    await expect(mockedPage.locator('[data-testid="inspector-header"]')).toContainText('Slot 3')

    await mockedPage.locator('[data-testid="inspector-value"]').focus()
    await mockedPage.keyboard.press('2')

    await expect(mockedPage.locator('[data-testid="inspector-header"]')).toContainText('Slot 3')
    await expect(mockedPage.locator('[data-testid="inspector-value"]')).toHaveValue('2')
  })

  test('typing a digit in inspector icon field does not change selected slot', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await mockedPage.locator('[data-testid="slot-2"]').click()
    await expect(mockedPage.locator('[data-testid="inspector-header"]')).toContainText('Slot 3')

    await mockedPage.locator('[data-testid="inspector-icon"]').focus()
    await mockedPage.keyboard.press('3')

    await expect(mockedPage.locator('[data-testid="inspector-header"]')).toContainText('Slot 3')
    await expect(mockedPage.locator('[data-testid="inspector-icon"]')).toHaveValue('3')
  })
})
