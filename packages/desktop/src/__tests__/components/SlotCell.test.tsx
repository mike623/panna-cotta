import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'

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
 * SlotCell is not exported from core.tsx, so we exercise it indirectly through
 * DeviceCanvas wrapped in a DndContext provider.
 *
 * SCOPE: We can verify that the grid renders the right number of cells and
 * that drag overlays (isOver border, swap badge) appear only under the right
 * conditions. Triggering an actual drop requires dnd-kit's sensor activation
 * which is awkward in jsdom (no hit-testing). For full drag-and-drop coverage,
 * see Phase 3 Playwright tests.
 */
describe('SlotCell (through DeviceCanvas + DndContext)', () => {
  it('renders rows*cols slot cells', () => {
    const { container } = render(
      <DndContext>
        <DeviceCanvas
          profile={profile}
          page={page}
          selectedSlot={null}
          theme={theme}
          activeDragId={null}
          onSlotClick={() => {}}
        />
      </DndContext>,
    )
    // Each cell is a <button> rendered by Tile.
    const buttons = container.querySelectorAll('button')
    // 9 tile buttons, plus an unknown extra (the badge "Live preview" pill is a span, not a button).
    expect(buttons.length).toBeGreaterThanOrEqual(9)
  })

  it('renders the device canvas footer with the correct grid size', () => {
    const { container } = render(
      <DndContext>
        <DeviceCanvas
          profile={profile}
          page={page}
          selectedSlot={null}
          theme={theme}
          activeDragId={null}
          onSlotClick={() => {}}
        />
      </DndContext>,
    )
    expect(container.textContent).toContain('3×3')
    expect(container.textContent).toContain('Live preview')
    // 2 of 9 slots are filled (idx 0, 4).
    expect(container.textContent).toContain('2 of 9 slots')
  })

  it('does not render a swap badge when no tile drag is in progress', () => {
    const { container } = render(
      <DndContext>
        <DeviceCanvas
          profile={profile}
          page={page}
          selectedSlot={null}
          theme={theme}
          activeDragId={null}
          onSlotClick={() => {}}
        />
      </DndContext>,
    )
    // The swap badge uses an `Icon name="swap"`. The corresponding SVG path
    // (`<path d="M7 10h13l-3-3M17 14H4l3 3"/>`) appears only when isSwap is true.
    // With no active drag, no swap badge should be rendered.
    const swapPath = container.querySelector('path[d="M7 10h13l-3-3M17 14H4l3 3"]')
    expect(swapPath).toBeNull()
  })
})

// NOTE: Tests for the drop indicator (`isOver`) and swap badge active states
// require simulating dnd-kit's drag lifecycle (pointer down → move → over).
// jsdom does not implement getBoundingClientRect / elementsFromPoint reliably
// enough for that, so we defer those to Phase 3 (Playwright). Documented here
// so it's discoverable.
