# dnd-kit Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace vanilla HTML5 drag-and-drop with `@dnd-kit/core` so drag-and-drop works reliably inside Tauri/WKWebView on macOS.

**Architecture:** `DndContext` wraps the three-zone body in `PannaApp.tsx`. A single `onDragEnd` dispatches to existing `onDropAction`/`onReorder`. Grid slots use `useDroppable`; filled tiles and palette items use `useDraggable`. A `DragOverlay` renders the floating ghost.

**Tech Stack:** @dnd-kit/core 6.x, @dnd-kit/utilities, React 18, Tauri 2, TypeScript

---

### Task 1: Install packages

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/package-lock.json`

- [ ] **Step 1: Install**

```bash
cd packages/desktop && npm install @dnd-kit/core @dnd-kit/utilities
```

Expected: `added 2 packages` (or similar), no errors.

- [ ] **Step 2: Verify**

```bash
grep dnd-kit packages/desktop/package.json
```

Expected: both `@dnd-kit/core` and `@dnd-kit/utilities` appear in `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/package.json packages/desktop/package-lock.json
git commit -m "chore: add @dnd-kit/core and @dnd-kit/utilities"
```

---

### Task 2: Scaffold DndContext in PannaApp.tsx

**Files:**
- Modify: `packages/desktop/src/PannaApp.tsx`

This pass adds the DndContext wrapper and wires handlers. DeviceCanvas and ActionPalette still use vanilla DnD at this point — that's OK, the app will still build.

- [ ] **Step 1: Add imports**

At the top of `PannaApp.tsx`, add after the existing Tauri import line:

```tsx
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
```

- [ ] **Step 2: Add state and sensors inside PannaApp()**

After `const [loading, setLoading] = useState(true)`, add:

```tsx
const [activeDragId, setActiveDragId] = useState<string | null>(null)
const [activeDragData, setActiveDragData] = useState<Record<string, unknown> | null>(null)
const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
```

- [ ] **Step 3: Add drag handlers inside PannaApp()**

After the `onReset` function, add:

```tsx
const handleDragStart = ({ active }: DragStartEvent) => {
  setActiveDragId(active.id as string)
  setActiveDragData((active.data.current as Record<string, unknown>) ?? null)
}

const handleDragEnd = ({ active, over }: DragEndEvent) => {
  setActiveDragId(null)
  setActiveDragData(null)
  if (!over) return
  const slotIdx = parseInt((over.id as string).replace('slot-', ''), 10)
  const d = active.data.current as {
    type: string
    from?: number
    actionId?: string
    name?: string
    value?: string
    iconOverride?: string
  }
  if (d.type === 'action') onDropAction(slotIdx, { actionId: d.actionId!, name: d.name!, value: d.value || '', iconOverride: d.iconOverride })
  if (d.type === 'tile')   onReorder(d.from!, slotIdx)
}
```

- [ ] **Step 4: Wrap body in DndContext**

In the JSX, find the `{/* Body — three zones */}` comment and its `<div>`. Wrap it:

```tsx
{/* Body — three zones */}
<DndContext
  sensors={sensors}
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
  onDragCancel={() => { setActiveDragId(null); setActiveDragData(null) }}
>
  <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14, padding: 14, position: 'relative', zIndex: 1 }}>
    {/* ... existing ProfilesRail, Glass panels unchanged ... */}
  </div>
  {/* DragOverlay placeholder — filled in Task 5 */}
</DndContext>
```

The closing `</DndContext>` goes after the body `</div>` and before `{/* Overlays */}`.

- [ ] **Step 5: Pass activeDragId to DeviceCanvas**

Find `<DeviceCanvas` in the JSX and add one prop:

```tsx
activeDragId={activeDragId}
```

- [ ] **Step 6: Remove onDropAction and onReorder props from DeviceCanvas call**

Since dispatch now happens in `handleDragEnd`, remove these two props from the `<DeviceCanvas ...>` JSX call:

```tsx
// Remove these two lines from the DeviceCanvas JSX:
onDropAction={onDropAction}
onReorder={onReorder}
```

- [ ] **Step 7: Verify build**

```bash
cd packages/desktop && npm run build 2>&1 | tail -30
```

Expected: TypeScript will warn that `activeDragId` is unknown on `DeviceCanvasProps`. That's expected — fixed in Task 3.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/PannaApp.tsx
git commit -m "feat: scaffold DndContext in PannaApp with drag handlers"
```

---

### Task 3: Migrate DeviceCanvas (core.tsx)

**Files:**
- Modify: `packages/desktop/src/core.tsx`

Replace all HTML5 DnD state and handlers with a `SlotCell` component using `useDroppable` + `useDraggable`.

- [ ] **Step 1: Add dnd-kit import**

At the top of `core.tsx`, after existing React import, add:

```tsx
import { useDroppable, useDraggable } from '@dnd-kit/core'
```

- [ ] **Step 2: Add SlotCell component**

Add the following component **after** the `Tile` component and **before** `DeviceCanvas`:

```tsx
interface SlotCellProps {
  idx: number
  slot: SlotData | undefined
  theme: Theme
  selected: boolean
  activeDragId: string | null
  onSlotClick: (idx: number) => void
  onFlipRef: (el: HTMLElement | null) => void
}

function SlotCell({ idx, slot, theme, selected, activeDragId, onSlotClick, onFlipRef }: SlotCellProps) {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `slot-${idx}` })
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({
    id: `tile-${idx}`,
    data: { type: 'tile', from: idx },
    disabled: !slot,
  })

  const activeDragFrom = activeDragId?.startsWith('tile-')
    ? parseInt(activeDragId.replace('tile-', ''), 10)
    : null
  const isSwap = isOver && activeDragFrom !== null && activeDragFrom !== idx && !!slot

  return (
    <div ref={dropRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {isOver && (
        <div style={{
          position: 'absolute', inset: -3,
          border: `2px solid ${theme.accent}`,
          borderRadius: theme.radius + 2,
          pointerEvents: 'none', zIndex: 2,
          boxShadow: `0 0 16px color-mix(in oklch, ${theme.accent} 40%, transparent)`,
        }} />
      )}
      {isSwap && (
        <div style={{
          position: 'absolute', top: -8, right: -8, zIndex: 3,
          width: 22, height: 22, borderRadius: 11,
          background: theme.accent,
          color: theme.dark ? 'oklch(0.18 0.01 250)' : 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
          pointerEvents: 'none',
        }}>
          <Icon name="swap" size={12} strokeWidth={2.2} color="currentColor" />
        </div>
      )}
      <div
        ref={(el) => { onFlipRef(el); if (slot) dragRef(el as HTMLElement) }}
        {...(slot ? { ...attributes, ...listeners } : {})}
        style={{
          width: '100%', height: '100%',
          opacity: isDragging ? 0.35 : 1,
          filter: isDragging ? 'saturate(0.6)' : 'none',
          transition: 'opacity .15s ease, filter .15s ease',
          willChange: 'transform',
          cursor: slot ? 'grab' : 'default',
          touchAction: 'none',
        }}
      >
        <Tile
          slot={slot}
          theme={theme}
          selected={selected}
          onClick={() => onSlotClick(idx)}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Replace DeviceCanvasProps interface**

Replace the existing `DeviceCanvasProps` interface entirely with:

```tsx
interface DeviceCanvasProps {
  profile: ProfileData
  page: PageData
  selectedSlot: number | null
  theme: Theme
  activeDragId: string | null
  onSlotClick: (idx: number) => void
}
```

(Remove `onDropAction` and `onReorder` — dispatch now happens in PannaApp's `handleDragEnd`.)

- [ ] **Step 4: Replace DeviceCanvas function body**

Replace the entire `export function DeviceCanvas(...)` with:

```tsx
export function DeviceCanvas({ profile, page, selectedSlot, theme, activeDragId, onSlotClick }: DeviceCanvasProps) {
  const { rows, cols } = profile
  const total = rows * cols

  const tileRefs  = useRef(new Map<string, HTMLElement>())
  const prevRects = useRef(new Map<string, DOMRect>())

  const slotKey = (s: SlotData | undefined) =>
    s ? `${s.actionId}|${s.label}|${s.value}|${s.iconOverride || ''}` : null

  useLayoutEffect(() => {
    const newRects = new Map<string, DOMRect>()
    tileRefs.current.forEach((el, key) => {
      if (el) newRects.set(key, el.getBoundingClientRect())
    })
    newRects.forEach((newRect, key) => {
      const prev = prevRects.current.get(key)
      const el   = tileRefs.current.get(key)
      if (!prev || !el) return
      const dx = prev.left - newRect.left
      const dy = prev.top  - newRect.top
      if (dx === 0 && dy === 0) return
      el.style.transition = 'none'
      el.style.transform  = `translate(${dx}px, ${dy}px)`
      void el.offsetWidth
      el.style.transition = 'transform .32s cubic-bezier(.2,.9,.3,1)'
      el.style.transform  = 'translate(0, 0)'
    })
    prevRects.current = newRects
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 84px)`,
        gridTemplateRows: `repeat(${rows}, 84px)`,
        gap: 12,
        padding: 4,
      }}>
        {Array.from({ length: total }).map((_, idx) => {
          const slot = page.slots[idx]
          return (
            <SlotCell
              key={idx}
              idx={idx}
              slot={slot}
              theme={theme}
              selected={selectedSlot === idx}
              activeDragId={activeDragId}
              onSlotClick={onSlotClick}
              onFlipRef={(el) => {
                const key = slotKey(slot)
                if (key) {
                  if (el) tileRefs.current.set(key, el)
                  else    tileRefs.current.delete(key)
                }
              }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: theme.textMute, fontFamily: theme.font }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 11px 5px 9px', borderRadius: 999,
          background: 'color-mix(in oklch, oklch(0.72 0.16 145) 12%, transparent)',
          color: 'oklch(0.72 0.16 145)',
          border: `0.5px solid color-mix(in oklch, oklch(0.6 0.16 145) 35%, transparent)`,
          fontWeight: 600, fontSize: 10.5, letterSpacing: '0.01em',
        }}>
          <span style={{ position: 'relative', width: 6, height: 6 }}>
            <span style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'oklch(0.72 0.18 145)', boxShadow: '0 0 6px oklch(0.72 0.18 145)',
            }} />
          </span>
          Live preview
        </span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{profile.rows}×{profile.cols}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ fontWeight: 500 }}>{Object.keys(page.slots).length} of {profile.rows * profile.cols} slots</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify build**

```bash
cd packages/desktop && npm run build 2>&1 | tail -30
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/core.tsx
git commit -m "feat: migrate DeviceCanvas to dnd-kit (useDroppable + useDraggable)"
```

---

### Task 4: Migrate ActionPalette (ui.tsx)

**Files:**
- Modify: `packages/desktop/src/ui.tsx`

Replace `draggable` + `onDragStart` on palette items with `useDraggable` components.

- [ ] **Step 1: Add dnd-kit import**

At the top of `ui.tsx`, after existing imports, add:

```tsx
import { useDraggable } from '@dnd-kit/core'
import type { QuickTemplate, ActionDef, ActionCategory } from './data'
```

- [ ] **Step 2: Add DraggableTemplate component**

Add before `ActionPalette`:

```tsx
function DraggableTemplate({ t, theme, onTemplate }: {
  t: QuickTemplate
  theme: Theme
  onTemplate: (t: QuickTemplate) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `template-${t.id}`,
    data: { type: 'action', actionId: t.actionId, name: t.name, value: t.value, iconOverride: t.icon },
  })
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onTemplate(t)}
      style={{
        all: 'unset', cursor: isDragging ? 'grabbing' : 'grab',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 4, padding: '8px 4px',
        background: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
        border: `0.5px solid ${theme.border}`,
        borderRadius: 8, fontSize: 10.5, color: theme.text, textAlign: 'center',
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)' }}
    >
      <Icon name={t.icon} size={16} color={theme.textMute} strokeWidth={1.7} />
      {t.name}
    </button>
  )
}
```

- [ ] **Step 3: Add DraggableAction component**

Add after `DraggableTemplate`:

```tsx
function DraggableAction({ a, cat, theme }: {
  a: ActionDef
  cat: ActionCategory
  theme: Theme
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `action-${a.id}`,
    data: { type: 'action', actionId: a.id, name: a.name, value: a.hint || '' },
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '6px 7px', borderRadius: 7,
        cursor: isDragging ? 'grabbing' : 'grab',
        color: theme.text, fontSize: 12, transition: 'background .12s',
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      <div style={{
        width: 22, height: 22, borderRadius: 6,
        background: `color-mix(in oklch, ${cat.color} 18%, transparent)`,
        color: cat.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={a.icon} size={13} strokeWidth={1.8} />
      </div>
      <span style={{ flex: 1 }}>{a.name}</span>
    </div>
  )
}
```

- [ ] **Step 4: Replace quick-templates map in ActionPalette**

Find the `{QUICK_TEMPLATES.map(t => (` block (the `<button key={t.id} draggable ...>` block) and replace it:

```tsx
{QUICK_TEMPLATES.map(t => (
  <DraggableTemplate key={t.id} t={t} theme={theme} onTemplate={onTemplate} />
))}
```

- [ ] **Step 5: Replace action items map in ActionPalette**

Find the `{cat.actions.map(a => (` block (the `<div key={a.id} draggable ...>` block) and replace it:

```tsx
{cat.actions.map(a => (
  <DraggableAction key={a.id} a={a} cat={cat} theme={theme} />
))}
```

- [ ] **Step 6: Verify build**

```bash
cd packages/desktop && npm run build 2>&1 | tail -30
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/ui.tsx
git commit -m "feat: migrate ActionPalette to dnd-kit useDraggable"
```

---

### Task 5: Add DragOverlay and final cleanup

**Files:**
- Modify: `packages/desktop/src/PannaApp.tsx`

- [ ] **Step 1: Import Tile in PannaApp.tsx**

`Tile` is needed for the drag overlay. Add it to the import from `./core`:

```tsx
import { Glass, DeviceCanvas, ProfilesRail, Tile } from './core'
```

- [ ] **Step 2: Replace the DragOverlay placeholder**

Find `{/* DragOverlay placeholder — filled in Task 5 */}` and replace with:

```tsx
<DragOverlay dropAnimation={null}>
  {activeDragData?.type === 'tile' && activeDragId && (() => {
    const fromIdx = parseInt((activeDragId as string).replace('tile-', ''), 10)
    const slot = activePage.slots[fromIdx]
    return slot ? (
      <div style={{ width: 84, height: 84, opacity: 0.9, filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.35))' }}>
        <Tile slot={slot} theme={theme} selected={false} onClick={() => {}} />
      </div>
    ) : null
  })()}
  {activeDragData?.type === 'action' && (
    <div style={{
      padding: '6px 12px', borderRadius: 8,
      background: theme.dark ? 'rgba(30,30,36,0.95)' : 'rgba(255,255,255,0.95)',
      border: `0.5px solid ${theme.borderStrong}`,
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      fontSize: 12, fontFamily: theme.font, color: theme.text, fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      {activeDragData.name as string}
    </div>
  )}
</DragOverlay>
```

- [ ] **Step 3: Verify full build**

```bash
cd packages/desktop && npm run build 2>&1
```

Expected: exit 0, zero TypeScript errors.

- [ ] **Step 4: Run dev and test manually**

```bash
cd packages/desktop && npm run tauri dev
```

Test these five scenarios:

1. Drag action from palette → drop onto **empty** slot → action appears
2. Drag action from palette → drop onto **filled** slot → slot updates  
3. Drag filled tile → drop onto **another filled** slot → tiles swap, FLIP animation plays
4. Drag filled tile → drop onto **empty** slot → tile moves, FLIP animation plays
5. Start drag, press **Escape** or drop outside grid → no state change

Confirm: drop indicator (accent border) appears on hover, drag ghost follows cursor.

- [ ] **Step 5: Final commit**

```bash
git add packages/desktop/src/PannaApp.tsx
git commit -m "feat: add DragOverlay and complete dnd-kit migration"
```
