import { test, expect, request as pwRequest } from '@playwright/test'

const baseURL = () => process.env.PANNA_BASE_URL!
const csrfToken = () => process.env.PANNA_CSRF_TOKEN!

/**
 * The /api/execute endpoint dispatches a button press to its action's plugin.
 * In the LAN test scenario no plugins are running, so a well-formed request
 * to a known context should return 503 (`no plugin running for actionUUID`)
 * — not 400/403. That's the assertion: the request is *accepted* (well-formed,
 * authenticated when needed, context exists), even though no plugin will
 * actually launch the app in the headless test env.
 */

test('POST /api/execute with valid context + CSRF returns 503 or 200 (request well-formed)', async ({ request }) => {
  const res = await request.post(`${baseURL()}/api/execute`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Panna-CSRF': csrfToken(),
    },
    data: { context: 'aaa111aaa111' }, // Calculator in seed
  })
  // Either 200 (dispatched) or 503 (no plugin running). Not 400, not 403, not 404.
  expect([200, 503]).toContain(res.status())
  const body = await res.json()
  if (res.status() === 503) {
    expect(body).toHaveProperty('error')
    expect(String(body.error)).toMatch(/no plugin running/i)
  } else {
    expect(body).toHaveProperty('success', true)
  }
})

test('POST /api/execute with unknown context returns 404', async ({ request }) => {
  const res = await request.post(`${baseURL()}/api/execute`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Panna-CSRF': csrfToken(),
    },
    data: { context: 'no_such_ctx' },
  })
  expect(res.status()).toBe(404)
})

test('POST /api/execute without body returns 400', async ({ request }) => {
  const res = await request.post(`${baseURL()}/api/execute`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Panna-CSRF': csrfToken(),
    },
    data: {},
  })
  expect(res.status()).toBe(400)
})

test('LAN frontend click intercepts /api/execute call with correct context', async ({ page }) => {
  // Block external CDN to avoid flake
  await page.route('https://unpkg.com/**', (route) => route.abort())

  // Intercept /api/execute and return a stub success. This lets us assert
  // the LAN frontend POSTs the correct body without actually launching apps.
  const executeRequests: any[] = []
  await page.route('**/api/execute', async (route) => {
    const req = route.request()
    executeRequests.push(req.postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  })

  await page.goto(`${baseURL()}/apps/`)
  const grid = page.locator('#grid-container')
  await expect(grid.locator('.grid-button')).toHaveCount(9)

  // First filled button is Calculator (context aaa111aaa111).
  const firstButton = grid.locator('.grid-button').first()
  await firstButton.click()

  // Wait for the intercepted call.
  await expect.poll(() => executeRequests.length, { timeout: 5_000 }).toBeGreaterThan(0)

  const body = executeRequests[0]
  expect(body).toHaveProperty('context')
  expect(body.context).toBe('aaa111aaa111')
})
