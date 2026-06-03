import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

import { DeviceCanvas } from '../../core'
import { makeTheme, DEFAULT_TWEAKS } from '../../theme'
import type { ProfileData, PageData, SlotData } from '../../data'

const theme = makeTheme(DEFAULT_TWEAKS)

const slotGit: SlotData = { actionId: 'open-url', label: 'GitHub', value: 'https://github.com' }
const slotCalc: SlotData = { actionId: 'open-app', label: 'Calc',   value: 'Calculator' }

const page: PageData = {
  id: 'p1',
  name: 'Home',
  slots: { 0: slotGit, 4: slotCalc },
}

const profile: ProfileData = {
  id: 'Default',
  name: 'Default',
  icon: 'home',
  rows: 3,
  cols: 3,
  pages: [page],
}

/**
 * DeviceCanvas uses native HTML5 drag API (no dnd-kit).
 *
 * SCOPE: We verify the grid renders the right number of cells and that the
 * footer metadata is correct. Full drag-and-drop coverage is in Phase 3
 * Playwright tests where real pointer events work.
 */
describe('DeviceCanvas (HTML5 drag)', () => {
  it('renders rows*cols slot cells', () => {
    const { container } = render(
      <DeviceCanvas
        profile={profile}
        page={page}
        selectedSlot={null}
        theme={theme}
        onSlotClick={() => {}}
        onDropAction={() => {}}
        onReorder={() => {}}
      />,
    )
    // Each cell is a <button> rendered by Tile.
    const buttons = container.querySelectorAll('button')
    // 9 tile buttons (the Live preview pill is a span, not a button).
    expect(buttons.length).toBeGreaterThanOrEqual(9)
  })

  it('renders the device canvas footer with the correct grid size', () => {
    const { container } = render(
      <DeviceCanvas
        profile={profile}
        page={page}
        selectedSlot={null}
        theme={theme}
        onSlotClick={() => {}}
        onDropAction={() => {}}
        onReorder={() => {}}
      />,
    )
    expect(container.textContent).toContain('3×3')
    expect(container.textContent).toContain('Live preview')
    // 2 of 9 slots are filled (idx 0, 4).
    expect(container.textContent).toContain('2 of 9 slots')
  })

  it('does not render a swap badge when no tile drag is in progress', () => {
    const { container } = render(
      <DeviceCanvas
        profile={profile}
        page={page}
        selectedSlot={null}
        theme={theme}
        onSlotClick={() => {}}
        onDropAction={() => {}}
        onReorder={() => {}}
      />,
    )
    // The swap badge uses an `Icon name="swap"`. The corresponding SVG path
    // (`<path d="M7 10h13l-3-3M17 14H4l3 3"/>`) appears only when isSwap is true.
    // With no active drag, no swap badge should be rendered.
    const swapPath = container.querySelector('path[d="M7 10h13l-3-3M17 14H4l3 3"]')
    expect(swapPath).toBeNull()
  })

  it('calls onSlotClick when a tile is clicked', async () => {
    const onSlotClick = vi.fn()
    const { container } = render(
      <DeviceCanvas
        profile={profile}
        page={page}
        selectedSlot={null}
        theme={theme}
        onSlotClick={onSlotClick}
        onDropAction={() => {}}
        onReorder={() => {}}
      />,
    )
    const firstButton = container.querySelector('button')!
    firstButton.click()
    expect(onSlotClick).toHaveBeenCalledTimes(1)
  })
})

// NOTE: Tests for the drop indicator and swap badge active states require
// simulating HTML5 drag lifecycle (dragstart → dragover → drop).
// jsdom does not implement getBoundingClientRect / elementsFromPoint reliably
// enough for that, so we defer those to Phase 3 (Playwright).
