import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Tile } from '../../core'
import { makeTheme, DEFAULT_TWEAKS } from '../../theme'
import type { SlotData } from '../../data'

const theme = makeTheme(DEFAULT_TWEAKS)

const filledSlot: SlotData = {
  actionId: 'open-url',
  label: 'GitHub',
  value: 'https://github.com',
  iconOverride: '',
}

describe('Tile', () => {
  it('renders empty tile (plus icon) when slot is undefined', () => {
    const onClick = vi.fn()
    const { container } = render(
      <Tile slot={undefined} theme={theme} selected={false} onClick={onClick} />,
    )
    // Empty tile renders a single button with the plus icon and no label text.
    const btn = container.querySelector('button')!
    expect(btn).toBeInTheDocument()
    // Plus icon SVG should be present.
    expect(btn.querySelector('svg')).toBeInTheDocument()
    // No label text content.
    expect(btn.textContent).toBe('')
  })

  it('renders label and icon for a filled slot', () => {
    const onClick = vi.fn()
    render(<Tile slot={filledSlot} theme={theme} selected={false} onClick={onClick} />)
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    // An SVG icon is rendered.
    const btn = screen.getByRole('button')
    expect(btn.querySelector('svg')).toBeInTheDocument()
  })

  it('uses slot.iconOverride when provided (vs. the action default icon)', () => {
    const override: SlotData = { ...filledSlot, iconOverride: 'spark' }
    const { rerender, container } = render(
      <Tile slot={filledSlot} theme={theme} selected={false} onClick={() => {}} />,
    )
    const svgBefore = container.querySelector('svg')!.outerHTML
    rerender(<Tile slot={override} theme={theme} selected={false} onClick={() => {}} />)
    const svgAfter = container.querySelector('svg')!.outerHTML
    // The icon paths are different between 'globe' (open-url default) and 'spark' override.
    expect(svgAfter).not.toBe(svgBefore)
  })

  it('applies accent ring (box-shadow) when selected=true', () => {
    const { container } = render(
      <Tile slot={filledSlot} theme={theme} selected={true} onClick={() => {}} />,
    )
    const btn = container.querySelector('button')!
    const style = btn.getAttribute('style') || ''
    // The selected box-shadow includes the accent color via 0 0 0 1.5px.
    expect(style).toMatch(/0 0 0 1\.5px/)
    expect(style).toContain(theme.accent)
  })

  it('reduces opacity when dimmed=true', () => {
    const { container } = render(
      <Tile slot={filledSlot} theme={theme} selected={false} dimmed onClick={() => {}} />,
    )
    const btn = container.querySelector('button')!
    const style = btn.getAttribute('style') || ''
    expect(style).toMatch(/opacity:\s*0\.35/)
  })

  it('applies scale(1.04) transform when dragState="over"', () => {
    const { container } = render(
      <Tile slot={filledSlot} theme={theme} selected={false} dragState="over" onClick={() => {}} />,
    )
    const btn = container.querySelector('button')!
    const style = btn.getAttribute('style') || ''
    expect(style).toMatch(/scale\(1\.04\)/)
  })

  it('invokes onClick when the tile is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Tile slot={filledSlot} theme={theme} selected={false} onClick={onClick} />)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('invokes onClick on empty tile too', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Tile slot={undefined} theme={theme} selected={false} onClick={onClick} />)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
