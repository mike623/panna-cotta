import { useState, useCallback } from 'react'

const HISTORY_CAP = 50

interface HistoryState<T> {
  history: T[]
  hIdx: number
}

/**
 * Generic undo/redo history hook.
 *
 * - `state` is always the snapshot at `hIdx`.
 * - `commit(next)` truncates forward history, appends, and caps the buffer at
 *   {@link HISTORY_CAP} entries (oldest dropped).
 * - `undo` / `redo` move the index; they're no-ops when at the bounds.
 * - `reset(snap)` replaces the entire history with a single snapshot.
 *
 * Both `history` and `hIdx` are tracked in a single piece of state so that
 * concurrent updates from React 18's batching never desynchronise them.
 */
export function useHistory<T>(initial: T) {
  const [{ history, hIdx }, setHs] = useState<HistoryState<T>>(() => ({
    history: [initial],
    hIdx: 0,
  }))

  const state = history[hIdx]

  const commit = useCallback((nextOrFn: T | ((cur: T) => T)) => {
    setHs(cur => {
      const curSnap = cur.history[cur.hIdx]
      const next = typeof nextOrFn === 'function'
        ? (nextOrFn as (c: T) => T)(curSnap)
        : nextOrFn
      // Trim any forward history beyond hIdx, then append the new snapshot.
      const trimmed = cur.history.slice(0, cur.hIdx + 1)
      const appended = [...trimmed, next]
      // Cap the buffer; drop the oldest entries so the newest is always at the tail.
      const capped = appended.length > HISTORY_CAP
        ? appended.slice(appended.length - HISTORY_CAP)
        : appended
      return { history: capped, hIdx: capped.length - 1 }
    })
  }, [])

  const undo = useCallback(() => {
    setHs(cur => (cur.hIdx > 0 ? { ...cur, hIdx: cur.hIdx - 1 } : cur))
  }, [])

  const redo = useCallback(() => {
    setHs(cur => (cur.hIdx < cur.history.length - 1
      ? { ...cur, hIdx: cur.hIdx + 1 }
      : cur))
  }, [])

  const reset = useCallback((snap: T) => {
    setHs({ history: [snap], hIdx: 0 })
  }, [])

  const canUndo = hIdx > 0
  const canRedo = hIdx < history.length - 1

  return { state, history, hIdx, commit, undo, redo, canUndo, canRedo, reset }
}

export const HISTORY_MAX = HISTORY_CAP
