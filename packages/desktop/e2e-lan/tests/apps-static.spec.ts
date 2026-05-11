import { test, expect } from '@playwright/test'

const baseURL = () => process.env.PANNA_BASE_URL!

test('GET /apps/ returns the embedded index.html', async ({ request }) => {
  const res = await request.get(`${baseURL()}/apps/`)
  expect(res.status()).toBe(200)
  const ct = res.headers()['content-type'] ?? ''
  expect(ct).toMatch(/text\/html/)
  const body = await res.text()
  expect(body).toContain('<title>Stream Deck</title>')
  expect(body).toContain('id="grid-container"')
})

test('GET /apps/app.js returns the LAN frontend script', async ({ request }) => {
  const res = await request.get(`${baseURL()}/apps/app.js`)
  expect(res.status()).toBe(200)
  const ct = res.headers()['content-type'] ?? ''
  // mime_guess returns either application/javascript or text/javascript
  expect(ct).toMatch(/javascript/)
  const body = await res.text()
  expect(body.length).toBeGreaterThan(100)
  // Sanity: the app.js calls /api/execute
  expect(body).toContain('/api/execute')
})

test('GET /apps/manifest.json returns a valid PWA manifest', async ({ request }) => {
  const res = await request.get(`${baseURL()}/apps/manifest.json`)
  expect(res.status()).toBe(200)
  const ct = res.headers()['content-type'] ?? ''
  expect(ct).toMatch(/json/)
  const manifest = await res.json()
  expect(manifest).toHaveProperty('name')
})

test('GET /apps redirects to /apps/', async ({ request }) => {
  const res = await request.get(`${baseURL()}/apps`, { maxRedirects: 0 })
  // Permanent redirect
  expect([301, 308]).toContain(res.status())
  expect(res.headers()['location']).toBe('/apps/')
})
