import { test, expect } from '@playwright/test'

const baseURL = () => process.env.PANNA_BASE_URL!
const csrfToken = () => process.env.PANNA_CSRF_TOKEN!

/**
 * `lanAllowed: false` semantics in the current implementation:
 *
 *  - GET /api/config: NOT filtered. The button still appears in the response;
 *    only `settings` is redacted when the request lacks a valid CSRF header.
 *    (See server/routes.rs::get_config — strips settings, keeps button stubs.)
 *
 *  - POST /api/execute: enforced. Calls from non-localhost addresses are
 *    rejected with 403 when the target button has `lanAllowed: false`. From
 *    localhost (this test runs from 127.0.0.1) the check is bypassed.
 *
 * Spec philosophy: test the implemented behavior. We can't simulate a non-
 * localhost client from inside Playwright (the binary listens on 0.0.0.0 but
 * the OS routes 127.0.0.1 as localhost), so we verify:
 *
 *  1. The `lanAllowed: false` button IS present in GET /api/config (current
 *     behavior — server does NOT filter it out).
 *  2. The button's settings are redacted to null when GET is called without
 *     CSRF — this is the only LAN-vs-admin distinction implemented today.
 *  3. The button IS dispatchable from localhost with valid CSRF (proving the
 *     gating runs only against non-localhost callers).
 *
 * If the project later adds "strip lanAllowed: false buttons from GET
 * /api/config on LAN", a new assertion goes here.
 */

const SECRET_CONTEXT = 'ccc333ccc333'

test('GET /api/config without CSRF includes lanAllowed:false buttons but redacts settings', async ({ request }) => {
  const res = await request.get(`${baseURL()}/api/config`)
  expect(res.status()).toBe(200)
  const cfg = await res.json()
  expect(cfg).toHaveProperty('buttons')
  const secret = (cfg.buttons as any[]).find((b) => b.context === SECRET_CONTEXT)
  expect(secret, 'lanAllowed:false button still appears in LAN config (settings stripped)').toBeTruthy()
  // settings is set to null/empty for unauthenticated LAN clients.
  expect(secret.settings === null || secret.settings === undefined || Object.keys(secret.settings ?? {}).length === 0)
    .toBeTruthy()
})

test('GET /api/config WITH CSRF returns lanAllowed:false buttons with full settings', async ({ request }) => {
  const res = await request.get(`${baseURL()}/api/config`, {
    headers: { 'X-Panna-CSRF': csrfToken() },
  })
  expect(res.status()).toBe(200)
  const cfg = await res.json()
  const secret = (cfg.buttons as any[]).find((b) => b.context === SECRET_CONTEXT)
  expect(secret).toBeTruthy()
  expect(secret.settings).toBeTruthy()
  expect(secret.settings).toHaveProperty('appName', 'Terminal')
})

test('POST /api/execute on lanAllowed:false button from localhost is accepted (gate is non-localhost only)', async ({ request }) => {
  const res = await request.post(`${baseURL()}/api/execute`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Panna-CSRF': csrfToken(),
    },
    data: { context: SECRET_CONTEXT },
  })
  // From localhost the lan-allowed gate does not apply. 503 is expected
  // because no plugin is loaded to dispatch the action in test env.
  expect(res.status()).not.toBe(403)
  expect([200, 503]).toContain(res.status())
})
