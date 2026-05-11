import { test, expect } from '../fixtures/fixtures'
import { defaultStore, installTauriMock, getCallsFor } from '../fixtures/tauriMock'

/**
 * NOTE: The React-based Inspector (current PannaApp) does not yet render a
 * Property Inspector iframe — that lives in the legacy Svelte ButtonEditor.
 * What we *can* verify here is that:
 *   1. The plugin discovery IPC (`list_plugins_cmd`) is invoked.
 *   2. Plugin actions appear inside the ActionPalette with the plugin's name
 *      as a category header.
 *   3. `get_plugin_render` is polled (or at least available).
 *
 * When the React Inspector grows iframe support, expand this spec to assert
 * the iframe src URL.
 */
test.describe('plugins: palette integration', () => {
  test('plugin actions appear in the palette', async ({ page }) => {
    const store = defaultStore()
    store.plugins = [{
      uuid: 'com.example.testplugin',
      name: 'Test Plugin',
      version: '1.0.0',
      author: 'Author',
      description: 'Demo plugin',
      status: 'running',
      actions: [
        { uuid: 'com.example.testplugin.foo', name: 'Foo Action', piPath: 'pi/index.html' },
        { uuid: 'com.example.testplugin.bar', name: 'Bar Action', piPath: null },
      ],
    }]
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()

    // list_plugins_cmd should have been called by the ActionPalette useEffect
    const calls = await getCallsFor(page, 'list_plugins_cmd')
    expect(calls.length).toBeGreaterThan(0)

    // The plugin category header should be in the action list
    await expect(page.locator('text=Test Plugin').first()).toBeVisible({ timeout: 3000 })
    // Both actions should render
    await expect(page.locator('text=Foo Action').first()).toBeVisible()
    await expect(page.locator('text=Bar Action').first()).toBeVisible()
  })

  test('plugin action drag drops onto a slot', async ({ page }) => {
    const store = defaultStore()
    store.plugins = [{
      uuid: 'com.example.dragplugin',
      name: 'Drag Plugin',
      version: '1.0.0',
      author: 'A',
      description: '',
      status: 'running',
      actions: [
        { uuid: 'com.example.dragplugin.click', name: 'Click Me', piPath: null },
      ],
    }]
    await installTauriMock(page, store)
    await page.goto('/')
    await expect(page.locator('text=Panna Cotta').first()).toBeVisible()
    await expect(page.locator('text=Click Me').first()).toBeVisible()

    // The plugin action is a DraggableAction with data-testid
    const action = page.locator('[data-testid="action-com.example.dragplugin.click"]')
    await action.scrollIntoViewIfNeeded()
    await expect(action).toBeVisible()

    const slot = page.locator('[data-testid="slot-2"]')
    const ab = await action.boundingBox()
    const sb = await slot.boundingBox()
    if (!ab || !sb) throw new Error('missing bounding boxes')
    await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2)
    await page.mouse.down()
    await page.mouse.move(ab.x + ab.width / 2 + 12, ab.y + ab.height / 2 + 12, { steps: 4 })
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 10 })
    await page.waitForTimeout(50)
    await page.mouse.up()

    await expect(page.locator('[data-testid="slot-2"][data-filled="true"]')).toBeVisible({ timeout: 5000 })
  })
})
