import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock the invoke module so listInstalledApps can be controlled per test.
// Default = resolves with three apps; specific tests override via spies.
vi.mock('../../lib/invoke', () => ({
  listInstalledApps: vi.fn().mockResolvedValue(['Calculator', '1Password', 'Safari']),
  listPlugins: vi.fn().mockResolvedValue([]),
}))

import { Inspector } from '../../ui'
import { makeTheme, DEFAULT_TWEAKS } from '../../theme'
import * as invokeModule from '../../lib/invoke'
import type { SlotData } from '../../data'

const theme = makeTheme(DEFAULT_TWEAKS)

function setup(slotOverride?: Partial<SlotData> | null) {
  const slot: SlotData | undefined =
    slotOverride === null
      ? undefined
      : { actionId: 'open-url', label: 'GitHub', value: 'https://github.com', iconOverride: '', ...slotOverride }

  const onChange = vi.fn()
  const onClear = vi.fn()
  const onClose = vi.fn()
  const onDuplicate = vi.fn()

  const utils = render(
    <Inspector
      slot={slot}
      slotIdx={3}
      theme={theme}
      onChange={onChange}
      onClear={onClear}
      onClose={onClose}
      onDuplicate={onDuplicate}
    />,
  )
  return { ...utils, slot, onChange, onClear, onClose, onDuplicate }
}

describe('Inspector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(invokeModule.listInstalledApps as ReturnType<typeof vi.fn>).mockResolvedValue([
      'Calculator', '1Password', 'Safari',
    ])
  })

  it('renders defaults for an empty slot (open-url, no label/value/icon)', () => {
    setup(null)
    // Header shows "Empty slot" when slot is undefined.
    expect(screen.getByText('Empty slot')).toBeInTheDocument()
    // Type select defaults to open-url.
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('open-url')
    // Label and value inputs are empty.
    const labelInput = screen.getByPlaceholderText('GitHub') as HTMLInputElement
    expect(labelInput.value).toBe('')
  })

  it('fires onChange with merged label when typing into Label field', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ label: '' })
    const labelInput = screen.getByPlaceholderText('GitHub')
    await user.type(labelInput, 'X')
    // Each keystroke fires onChange. We assert the final call shape carries the new label.
    const last = onChange.mock.calls.at(-1)![0]
    expect(last).toMatchObject({ label: 'X', actionId: 'open-url' })
  })

  it('preserves label when changing Type via select', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ label: 'Keep me', actionId: 'open-url' })
    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'open-app')
    const last = onChange.mock.calls.at(-1)![0]
    expect(last).toMatchObject({ actionId: 'open-app', label: 'Keep me' })
  })

  it('sets iconOverride when clicking a suggested icon', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ iconOverride: '' })
    // The suggestion icons are rendered as buttons inside the suggested-icons grid.
    // We can find them by their distinctive Lucide names (one of the suggestions is 'github').
    // The simplest robust way: render then query all <button> inside the document,
    // pick the ones whose container has the "Suggested icons" heading sibling.
    const grid = screen.getByText('Suggested icons').parentElement!
    const iconButtons = grid.querySelectorAll('button')
    expect(iconButtons.length).toBeGreaterThan(0)
    await user.click(iconButtons[0])
    const last = onChange.mock.calls.at(-1)![0]
    expect(last).toHaveProperty('iconOverride')
    expect(typeof last.iconOverride).toBe('string')
    expect(last.iconOverride.length).toBeGreaterThan(0)
  })

  it('calls onDuplicate when Duplicate button clicked', async () => {
    const user = userEvent.setup()
    const { onDuplicate } = setup()
    await user.click(screen.getByRole('button', { name: /Duplicate/i }))
    expect(onDuplicate).toHaveBeenCalledTimes(1)
  })

  it('calls onClear when Clear button clicked', async () => {
    const user = userEvent.setup()
    const { onClear } = setup()
    await user.click(screen.getByRole('button', { name: /Clear/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the close (X) button is clicked', async () => {
    const user = userEvent.setup()
    const { onClose } = setup()
    // The X button has no accessible label, so locate it by being a sibling of the slot header.
    // It is the only button rendered before the field controls inside the top header row.
    const headerSlot = screen.getByText('Slot 4').parentElement!.parentElement!
    const closeBtn = headerSlot.querySelector('button')!
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders datalist of installed apps when actionId is open-app and apps resolve', async () => {
    setup({ actionId: 'open-app', label: 'Calc', value: '' })
    // The datalist is conditional on the listInstalledApps promise resolving,
    // so poll until it appears (max ~50ms via findBy-like polling).
    let dl: HTMLDataListElement | null = null
    for (let i = 0; i < 50 && !dl; i++) {
      await new Promise(r => setTimeout(r, 5))
      dl = document.getElementById('installed-apps-list') as HTMLDataListElement | null
    }
    expect(dl, 'expected datalist with id "installed-apps-list"').not.toBeNull()
    const options = dl!.querySelectorAll('option')
    expect(options).toHaveLength(3)
    expect(Array.from(options).map(o => o.getAttribute('value'))).toEqual([
      'Calculator', '1Password', 'Safari',
    ])
  })

  it('renders a plain input (no datalist) when listInstalledApps rejects', async () => {
    ;(invokeModule.listInstalledApps as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no apps'))
    setup({ actionId: 'open-app' })
    // Give the rejected promise a microtask to settle.
    await new Promise(r => setTimeout(r, 0))
    const dl = document.getElementById('installed-apps-list')
    expect(dl).toBeNull()
  })
})
