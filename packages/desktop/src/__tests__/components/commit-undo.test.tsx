import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useHistory, HISTORY_MAX } from '../../lib/useHistory'

/**
 * Tests for the commit/undo/redo history used by PannaApp.
 *
 * APPROACH: Option B from the plan — the history logic was extracted into
 * `useHistory()` so it can be tested directly with `renderHook`. Testing it
 * through <PannaApp /> would require mocking 5+ Tauri commands and driving
 * keyboard shortcuts; the hook is the canonical source of truth either way.
 */
describe('useHistory', () => {
  it('starts with a single snapshot at hIdx=0', () => {
    const initial = { n: 0 }
    const { result } = renderHook(() => useHistory(initial))
    expect(result.current.history).toEqual([initial])
    expect(result.current.hIdx).toBe(0)
    expect(result.current.state).toBe(initial)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('commit appends a snapshot and increments hIdx', () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.commit({ n: 1 }))
    act(() => result.current.commit({ n: 2 }))
    act(() => result.current.commit({ n: 3 }))
    expect(result.current.history).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }])
    expect(result.current.hIdx).toBe(3)
    expect(result.current.state).toEqual({ n: 3 })
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  it('commit accepts a function and passes the current snapshot', () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.commit(cur => ({ n: cur.n + 10 })))
    act(() => result.current.commit(cur => ({ n: cur.n + 1 })))
    expect(result.current.state).toEqual({ n: 11 })
    expect(result.current.history).toHaveLength(3)
  })

  it('undo decrements hIdx and exposes the prior state', () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.commit({ n: 1 }))
    act(() => result.current.commit({ n: 2 }))
    act(() => result.current.commit({ n: 3 }))
    act(() => result.current.undo())
    act(() => result.current.undo())
    expect(result.current.hIdx).toBe(1)
    expect(result.current.state).toEqual({ n: 1 })
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(true)
  })

  it('redo moves forward through the buffer', () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.commit({ n: 1 }))
    act(() => result.current.commit({ n: 2 }))
    act(() => result.current.undo())
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 0 })
    act(() => result.current.redo())
    expect(result.current.hIdx).toBe(1)
    expect(result.current.state).toEqual({ n: 1 })
  })

  it('undo at hIdx=0 is a no-op', () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.undo())
    expect(result.current.hIdx).toBe(0)
  })

  it('redo at the tail is a no-op', () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.commit({ n: 1 }))
    act(() => result.current.redo())
    expect(result.current.hIdx).toBe(1)
  })

  it('commit after undo trims the forward history', () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.commit({ n: 1 }))
    act(() => result.current.commit({ n: 2 }))
    act(() => result.current.commit({ n: 3 }))
    act(() => result.current.undo())
    act(() => result.current.undo())
    // We're at n=1 (hIdx=1). Commit a divergent branch.
    act(() => result.current.commit({ n: 99 }))
    // Forward history (n=2, n=3) should be gone.
    expect(result.current.history).toEqual([{ n: 0 }, { n: 1 }, { n: 99 }])
    expect(result.current.hIdx).toBe(2)
    expect(result.current.canRedo).toBe(false)
  })

  it('caps history at HISTORY_MAX entries (oldest dropped)', () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    // Commit HISTORY_MAX times so the buffer reaches its cap.
    for (let i = 1; i <= HISTORY_MAX; i++) {
      act(() => result.current.commit({ n: i }))
    }
    expect(result.current.history).toHaveLength(HISTORY_MAX)
    // Oldest dropped: the first entry should now be n=1, not n=0.
    expect(result.current.history[0]).toEqual({ n: 1 })
    expect(result.current.history[HISTORY_MAX - 1]).toEqual({ n: HISTORY_MAX })
    expect(result.current.hIdx).toBe(HISTORY_MAX - 1)
  })

  it('reset replaces the entire history with a single snapshot at hIdx=0', () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.commit({ n: 1 }))
    act(() => result.current.commit({ n: 2 }))
    act(() => result.current.reset({ n: 99 }))
    expect(result.current.history).toEqual([{ n: 99 }])
    expect(result.current.hIdx).toBe(0)
    expect(result.current.state).toEqual({ n: 99 })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })
})
