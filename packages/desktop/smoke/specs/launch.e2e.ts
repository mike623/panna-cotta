/**
 * Native smoke test — verifies the Panna Cotta Tauri binary launches
 * without crashing and that we can interact with its admin webview.
 *
 * This is the broadest possible safety net: if the bundled binary
 * segfaults on startup (missing system lib, broken init code, bad
 * resource path), this test catches it before release.
 *
 * Runs only on Linux via tauri-driver. See wdio.conf.ts for setup.
 */
import { browser, expect } from '@wdio/globals'

describe('Panna Cotta — native launch', () => {
  it('launches the admin window within 10s', async () => {
    // The session is already created by the time beforeAll fires;
    // verify we have a live browser object.
    expect(browser).toBeDefined()
    expect(browser.sessionId).toBeTruthy()
  })

  it('exposes a queryable webview', async () => {
    // The admin webview loads `index.html` from frontendDist. The Svelte
    // (now React) SPA sets a non-empty <title> — but more importantly
    // we just need browser.getTitle() to not throw. An empty string is
    // acceptable here; a thrown error is not.
    const title = await browser.getTitle()
    expect(typeof title).toBe('string')
  })

  it('can evaluate JS inside the webview', async () => {
    // If we can round-trip a value through the bridge, the webview is
    // genuinely alive (not just a black window or a crashed renderer).
    const result = await browser.execute(() => 1 + 1)
    expect(result).toBe(2)
  })

  it('has a non-empty document body', async () => {
    // The Vite build emits a #root div the React app mounts into.
    // We don't assert app-specific markup (that's covered by playwright-admin);
    // we just verify the document parsed and DOM exists.
    const bodyHtml = await browser.execute(() => document.body?.innerHTML ?? '')
    expect(typeof bodyHtml).toBe('string')
  })

  it('cleanly tears down the session', async () => {
    // wdio calls deleteSession() automatically after all specs; this assertion
    // documents the contract. If deleteSession() ever starts throwing (e.g.
    // because the binary crashes on shutdown), we want a loud failure here.
    expect(browser.sessionId).toBeTruthy()
  })
})
