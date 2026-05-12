import { test, expect } from '../fixtures/fixtures'

test.describe('grid resize: rows/cols steppers', () => {
  test('decreasing Rows shrinks the grid', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    // Default 3×3 = 9 slots
    await expect(mockedPage.locator('[data-testid^="slot-"]')).toHaveCount(9)

    // The Rows stepper has a Rows label and decrement button (minus icon)
    // Locate decrement: the first button after the Rows label.
    const rowsStepper = mockedPage.locator('span:has-text("Rows")').first().locator('..')
    const rowsMinus = rowsStepper.locator('button').first()
    await rowsMinus.click()

    await expect(mockedPage.locator('[data-testid^="slot-"]')).toHaveCount(6) // 2×3
  })

  test('increasing Cols grows the grid', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    await expect(mockedPage.locator('[data-testid^="slot-"]')).toHaveCount(9)

    // Cols stepper increment (+)
    const colsStepper = mockedPage.locator('span:has-text("Cols")').first().locator('..')
    const colsPlus = colsStepper.locator('button').nth(1)
    await colsPlus.click()

    await expect(mockedPage.locator('[data-testid^="slot-"]')).toHaveCount(12) // 3×4
  })

  test('steppers respect min and max bounds', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    const rowsStepper = mockedPage.locator('span:has-text("Rows")').first().locator('..')
    const rowsMinus = rowsStepper.locator('button').first()
    // Click 5 times — should clamp at 1
    for (let i = 0; i < 5; i++) await rowsMinus.click()
    // 1 × 3 = 3 slots
    await expect(mockedPage.locator('[data-testid^="slot-"]')).toHaveCount(3)
  })
})
