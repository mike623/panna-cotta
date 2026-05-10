# DnD Kit Migration Design
**Date:** 2026-05-04  
**Status:** Approved

## Problem

Vanilla HTML5 drag and drop is broken in Tauri/WKWebView on macOS. WebKit has known bugs with custom DataTransfer MIME types, `dragenter`/`dragover` event propagation, and `dragleave` false-fires on child entry. Multiple fix attempts did not resolve it reliably.

## Solution

Replace vanilla HTML5 DnD with `@dnd-kit/core`, which uses pointer events under the hood — not the HTML5 DnD API — making it reliable in Tauri webviews.

## Packages

```
@dnd-kit/core       — DndContext, useDraggable, useDroppable, DragOverlay, sensors
@dnd-kit/utilities  — CSS.Transform.toString (for transform style)
```

No `@dnd-kit/sortable` — the grid uses swap semantics, not list sorting.

## Architecture

### DndContext placement

`DndContext` wraps the body area in `PannaApp.tsx`. It holds a single `onDragEnd` handler that dispatches to existing `onDropAction` or `onReorder` callbacks.

Sensors: `PointerSensor` with a small activation distance (8px) to distinguish clicks from drags.

### Drag sources

| Source | Hook | id | data |
|---|---|---|---|
| Action palette item | `useDraggable` | `action-${a.id}` | `{ type: 'action', actionId, name, value }` |
| Quick-add template | `useDraggable` | `template-${t.id}` | `{ type: 'action', actionId, name, value, iconOverride }` |
| Filled grid tile | `useDraggable` | `tile-${idx}` | `{ type: 'tile', from: idx }` |

### Drop targets

Each grid slot cell: `useDroppable({ id: 'slot-${idx}' })`. The `isOver` boolean drives the accent-border overlay (replaces `hoverIdx`/`dragOver` state).

### onDragEnd handler

```ts
onDragEnd({ active, over }) {
  if (!over) return
  const slotIdx = parseInt(over.id.toString().replace('slot-', ''), 10)
  const d = active.data.current
  if (d.type === 'action') onDropAction(slotIdx, d)
  if (d.type === 'tile')   onReorder(d.from, slotIdx)
}
```

### DragOverlay

A `DragOverlay` renders the floating preview during drag. For tiles it renders a `<Tile>` clone; for actions it renders a small label pill. Replaces the manually-appended ghost div.

## Files Changed

| File | Change |
|---|---|
| `package.json` | Add `@dnd-kit/core`, `@dnd-kit/utilities` |
| `PannaApp.tsx` | Wrap body in `DndContext`, add `onDragEnd`, add `DragOverlay` |
| `core.tsx` — `DeviceCanvas` | Replace HTML5 handlers + state with `useDroppable` per slot, `useDraggable` per tile |
| `ui.tsx` — `ActionPalette` | Replace `draggable`/`onDragStart` with `useDraggable` per action item |

## Deleted Code

- All `onDragOver`, `onDragLeave`, `onDrop`, `onDragStart`, `onDragEnd` HTML5 React handlers
- `dragFrom`, `dragOver`, `hoverIdx`, `dragKind` state in `DeviceCanvas`
- The invisible `position: absolute; inset: 0` draggable overlay div
- All `e.dataTransfer` usage
- Manual ghost div appended to `document.body`
- `text/plain` DataTransfer key (from prior fix attempt)

## What Stays the Same

- `onDropAction` and `onReorder` callbacks in `PannaApp.tsx` — unchanged
- FLIP animation logic in `DeviceCanvas` using `useLayoutEffect` — unchanged
- The `Tile` component — unchanged
- Drop indicator visual style (accent border, scale) — same, driven by `isOver` instead of state
