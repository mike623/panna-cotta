import { test, expect } from '@playwright/test'

const baseURL = () => process.env.PANNA_BASE_URL!
const csrfToken = () => process.env.PANNA_CSRF_TOKEN!

/**
 * Playwright's `request` fixture connects from 127.0.0.1 → the server treats
 * it as localhost and requires `X-Panna-CSRF` on /api/execute. (LAN-origin
 * requests would skip CSRF; we can't simulate non-localhost from the test
 * harness, so this suite covers the localhost path which is the one with the
 * stricter check.)
 */

test('POST /api/execute without CSRF header returns 403', async ({ request }) => {
  const res = await request.post(`${baseURL()}/api/execute`, {
    headers: { 'Content-Type': 'application/json' },
    data: { context: 'aaa111aaa111' },
  })
  expect(res.status()).toBe(403)
  const body = await res.json()
  expect(body).toHaveProperty('error')
  expect(String(body.error)).toMatch(/CSRF/i)
})

test('POST /api/execute with WRONG CSRF token returns 403', async ({ request }) => {
  const res = await request.post(`${baseURL()}/api/execute`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Panna-CSRF': 'not_the_real_token_at_all_'.padEnd(64, '0'),
    },
    data: { context: 'aaa111aaa111' },
  })
  expect(res.status()).toBe(403)
})

test('POST /api/execute with correct CSRF token is accepted (not 403)', async ({ request }) => {
  const res = await request.post(`${baseURL()}/api/execute`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Panna-CSRF': csrfToken(),
    },
    data: { context: 'aaa111aaa111' },
  })
  expect(res.status()).not.toBe(403)
})
