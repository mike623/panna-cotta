import { test, expect } from '../fixtures/fixtures'

test.describe('theme: dark mode persistence', () => {
  test('toggling dark mode writes to localStorage and survives reload', async ({ mockedPage }) => {
    await mockedPage.goto('/')
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()

    // Capture initial dark state (DEFAULT_TWEAKS.dark is the default — we
    // assert behaviour relative to it).
    const initial = await mockedPage.evaluate(() => {
      const raw = localStorage.getItem('panna-tweaks')
      return raw ? (JSON.parse(raw).dark as boolean) : null
    })

    // The toolbar exposes a theme toggle as the icon button titled "Toggle theme".
    await mockedPage.locator('button[title="Toggle theme"]').click()

    // localStorage panna-tweaks should now reflect the new dark value
    await mockedPage.waitForFunction(() => {
      const raw = localStorage.getItem('panna-tweaks')
      return !!raw
    })
    const afterToggle = await mockedPage.evaluate(() => JSON.parse(localStorage.getItem('panna-tweaks') || '{}'))
    expect(afterToggle.dark).toBeDefined()
    if (initial !== null) {
      expect(afterToggle.dark).toBe(!initial)
    }

    // Reload: localStorage persists across reload by default in Playwright
    await mockedPage.reload()
    await expect(mockedPage.locator('text=Panna Cotta').first()).toBeVisible()
    const afterReload = await mockedPage.evaluate(() => JSON.parse(localStorage.getItem('panna-tweaks') || '{}'))
    expect(afterReload.dark).toBe(afterToggle.dark)
  })
})
