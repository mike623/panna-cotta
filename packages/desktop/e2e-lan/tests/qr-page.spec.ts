import { test, expect } from '@playwright/test'

const baseURL = () => process.env.PANNA_BASE_URL!

test('GET / returns the QR setup page with LAN URL', async ({ request }) => {
  const res = await request.get(`${baseURL()}/`)
  expect(res.status()).toBe(200)
  const body = await res.text()
  // Expect the LAN URL marker (host:port/apps/) somewhere in the markup.
  // The server fills in the LAN IP via outbound UDP probe; in CI/Docker this
  // can resolve to either 127.0.0.1 or a private IP. Accept either form.
  expect(body).toMatch(/:\d{5}\/apps\//)
  expect(body).toContain('/apps/')
  // QR is delivered as an <img src=".../api/qrserver..."> — assert the tag.
  expect(body).toMatch(/<img[^>]+src=/i)
  expect(body.toLowerCase()).toContain('panna cotta')
})
