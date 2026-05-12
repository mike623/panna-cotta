import { describe, it } from 'vitest'

/**
 * FLIP (First-Last-Invert-Play) animation tests for DeviceCanvas slot reorders.
 *
 * STATUS: SKIPPED in Phase 2.
 *
 * REASON: The FLIP effect in `core.tsx#DeviceCanvas.useLayoutEffect` relies on
 * `element.getBoundingClientRect()` to compute pre/post layout deltas, then
 * applies `transform: translate(dx, dy)` and forces a reflow with
 * `void el.offsetWidth`. jsdom returns `{ top: 0, left: 0, width: 0, height: 0 }`
 * for every element (no actual layout engine), so the dx/dy deltas are always
 * zero and the early-return short-circuits the animation. There is no
 * meaningful state we can assert in this environment.
 *
 * Coverage for this feature belongs in Phase 3 (Playwright + real Chromium)
 * where actual layout values are produced and we can observe the transform
 * being applied for one frame before settling back to identity.
 */
describe.skip('DeviceCanvas FLIP animation', () => {
  it('translates moved tiles by their old-vs-new layout delta', () => {
    // See header comment — covered by Phase 3 Playwright tests.
  })
})
