import { test, expect } from '@playwright/test'

const baseURL = () => process.env.PANNA_BASE_URL!

/**
 * Plugin-render WebSocket flow is intentionally out of scope for this LAN
 * E2E pass. Rationale (and what would be needed to enable it):
 *
 *  - The /ws endpoint requires:
 *      a) localhost ConnectInfo (OK from Playwright)
 *      b) plugin registration via Stream Deck SDK handshake — the server
 *         expects a `registerPlugin` message with a previously-issued token.
 *         Tokens are minted by the plugin host when it spawns a plugin
 *         process; there is no test-harness path to mint one.
 *      c) A loaded manifest in `host.manifests` matching the action UUIDs
 *         the test wants to drive.
 *
 *  - To make this testable we would need either:
 *      i) a test-only "fake plugin" injection API behind PANNA_CONFIG_DIR,
 *     ii) a real plugin spawned via the plugins/ resource directory + a
 *         working node runtime in the test env,
 *    iii) the server exposing a debug endpoint that authoritatively sets
 *         `plugin_render` entries without going through the plugin protocol.
 *
 *  - None of these exist today. Phase-4 of the e2e plan flags this spec as
 *    optional: "skip if plugin host needs more wiring than available." We do.
 *
 *  - We still verify the static-state endpoint /api/plugin-render is
 *    reachable, returns 200, and has the expected shape — that's enough to
 *    catch route-level regressions until the deeper wiring lands.
 */

test('GET /api/plugin-render returns the empty render state when no plugins are loaded', async ({ request }) => {
  const res = await request.get(`${baseURL()}/api/plugin-render`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body).toHaveProperty('images')
  expect(body).toHaveProperty('titles')
  expect(body).toHaveProperty('states')
  // No plugins loaded → all maps empty.
  expect(Object.keys(body.images ?? {})).toHaveLength(0)
  expect(Object.keys(body.titles ?? {})).toHaveLength(0)
  expect(Object.keys(body.states ?? {})).toHaveLength(0)
})

test.skip('WS setImage updates LAN cell rendering — requires plugin handshake wiring', () => {
  // Intentionally skipped. See file header for rationale.
})
