import React, { useRef, useLayoutEffect } from 'react'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { Icon } from './icons'
import { findAction } from './data'
import type { SlotData, PageData, ProfileData } from './data'
import type { Theme } from './theme'

// ── Glass primitive ─────────────────────────────────────────────────────────
interface GlassProps {
  children: React.ReactNode
  theme: Theme
  strong?: boolean
  radius?: number
  style?: React.CSSProperties
  [key: string]: unknown
}

export function Glass({ children, theme, strong = false, radius, style = {}, ...rest }: GlassProps) {
  const r = radius ?? theme.radius
  return (
    <div {...rest} style={{
      position: 'relative',
      background: strong ? theme.panelStrong : theme.panel,
      backdropFilter: theme.blur,
      WebkitBackdropFilter: theme.blur,
      border: `0.5px solid ${theme.border}`,
      borderRadius: r,
      boxShadow: `0 0 0 0.5px ${theme.borderStrong} inset, 0 1px 0 ${theme.inset} inset, 0 8px 32px rgba(0,0,0,0.12)`,
      ...style,
    }}>{children}</div>
  )
}

// ── Action Tile ─────────────────────────────────────────────────────────────
interface TileProps {
  slot: SlotData | undefined
  theme: Theme
  selected: boolean
  dimmed?: boolean
  onClick: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  dragState?: 'over' | null
}

export function Tile({ slot, theme, selected, dimmed, onClick, onMouseDown, dragState }: TileProps) {
  if (!slot) {
    const dashRest  = theme.dark ? 'rgba(255,255,255,0.07)'  : 'rgba(0,0,0,0.07)'
    const dashHover = theme.dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)'
    const fillRest  = 'transparent'
    const fillHover = theme.dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)'
    const iconRest  = theme.dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)'
    const iconHover = theme.dark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.45)'
    return (
      <button onClick={onClick} style={{
        all: 'unset', cursor: 'pointer',
        boxSizing: 'border-box',
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: fillRest,
        border: `1px dashed ${dashRest}`,
        borderRadius: 12,
        color: iconRest,
        transition: 'all .18s ease', position: 'relative',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget
        el.style.background = fillHover
        el.style.color = iconHover
        el.style.borderColor = dashHover
      }}
      onMouseLeave={e => {
        const el = e.currentTarget
        el.style.background = fillRest
        el.style.color = iconRest
        el.style.borderColor = dashRest
      }}>
        <Icon name="plus" size={16} strokeWidth={1.5} />
      </button>
    )
  }

  const action = findAction(slot.actionId)
  const iconName = slot.iconOverride || action?.icon || 'spark'
  const accent = action?.color || theme.accent
  const ICON_SIZE  = 28
  const LABEL_SIZE = 10
  const surface = theme.dark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.025)'
  const surfaceHover = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.045)'
  const stroke = theme.dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'

  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      style={{
        all: 'unset', cursor: 'pointer', position: 'relative',
        boxSizing: 'border-box',
        width: '100%', height: '100%',
        display: 'grid',
        gridTemplateRows: '1fr auto',
        justifyItems: 'center', alignItems: 'center',
        rowGap: 6,
        padding: '14px 6px 10px',
        background: surface,
        boxShadow: selected
          ? `0 0 0 1.5px ${theme.accent}, 0 0 0 4px color-mix(in oklch, ${theme.accent} 22%, transparent)`
          : `inset 0 0 0 1px ${stroke}`,
        borderRadius: 12,
        color: theme.text,
        transition: 'background .15s ease, box-shadow .15s ease, transform .15s ease',
        opacity: dimmed ? 0.35 : 1,
        transform: dragState === 'over' ? 'scale(1.04)' : 'scale(1)',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = surfaceHover }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = surface }}>
      <div style={{
        width: ICON_SIZE, height: ICON_SIZE,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        alignSelf: 'end',
      }}>
        <Icon name={iconName} size={ICON_SIZE} strokeWidth={1.5} color={accent} />
      </div>
      <div style={{
        fontSize: LABEL_SIZE, fontWeight: 500, letterSpacing: '0.01em',
        color: theme.textMute, lineHeight: 1, maxWidth: '100%',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        padding: '0 4px',
      }}>{slot.label}</div>
    </button>
  )
}

// ── Slot Cell ───────────────────────────────────────────────────────────────
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
        ref={(el) => { onFlipRef(el); dragRef(el) }}
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

// ── Device Canvas ───────────────────────────────────────────────────────────
interface DeviceCanvasProps {
  profile: ProfileData
  page: PageData
  selectedSlot: number | null
  theme: Theme
  activeDragId: string | null
  onSlotClick: (idx: number) => void
}

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
              key={idx} /* index key intentional: stable identity required for FLIP animation */
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

// ── Profiles Rail ───────────────────────────────────────────────────────────
interface ProfilesRailProps {
  profiles: ProfileData[]
  activeProfileId: string
  activePageId: string
  onProfile: (id: string) => void
  onPage: (id: string) => void
  onAddProfile: () => void
  onAddPage: () => void
  onImportProfile: () => void
  theme: Theme
}

export function ProfilesRail({ profiles, activeProfileId, activePageId, onProfile, onPage, onAddProfile, onAddPage, onImportProfile, theme }: ProfilesRailProps) {
  const active = profiles.find(p => p.id === activeProfileId)
  return (
    <Glass theme={theme} radius={theme.radiusLg} style={{
      width: 196, padding: '14px 10px',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div style={{
        padding: '0 8px', fontSize: 9.5, fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: theme.textFaint,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Profiles</span>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 4,
          background: theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
          color: theme.textFaint, letterSpacing: 0,
        }}>{profiles.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {profiles.map(p => {
          const isActive = p.id === activeProfileId
          return (
            <button key={p.id} onClick={() => onProfile(p.id)} style={{
              all: 'unset', cursor: 'pointer', position: 'relative',
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 9px', borderRadius: 9,
              background: isActive
                ? (theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)')
                : 'transparent',
              color: isActive ? theme.text : theme.textMute,
              transition: 'background .12s, color .12s',
            }}
            onMouseEnter={e => !isActive && (e.currentTarget.style.background = theme.dark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.025)')}
            onMouseLeave={e => !isActive && (e.currentTarget.style.background = 'transparent')}>
              {isActive && (
                <span style={{
                  position: 'absolute', left: -10, top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3, height: 16, borderRadius: 2,
                  background: theme.accent,
                  boxShadow: `0 0 8px color-mix(in oklch, ${theme.accent} 60%, transparent)`,
                }} />
              )}
              <div style={{
                width: 26, height: 26, borderRadius: 7,
                background: isActive
                  ? `linear-gradient(160deg, color-mix(in oklch, ${theme.accent} 95%, white), ${theme.accent})`
                  : (theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
                color: isActive ? 'white' : theme.textMute,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: isActive
                  ? `0 0.5px 0 rgba(255,255,255,0.4) inset, 0 2px 6px color-mix(in oklch, ${theme.accent} 35%, transparent)`
                  : 'none',
              }}>
                <Icon name={p.icon} size={13} strokeWidth={1.9} />
              </div>
              <div style={{ flex: 1, fontSize: 12.5, fontWeight: isActive ? 600 : 500, letterSpacing: '-0.005em' }}>{p.name}</div>
              <span style={{ fontSize: 9.5, color: theme.textFaint, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                {p.rows}×{p.cols}
              </span>
            </button>
          )
        })}
        <button onClick={onAddProfile} style={{
          all: 'unset', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 9px', borderRadius: 9,
          color: theme.textFaint, fontSize: 12,
          marginTop: 2,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.025)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            border: `1px dashed ${theme.borderStrong}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="plus" size={12} strokeWidth={1.7} />
          </div>
          New profile
        </button>
        <button onClick={onImportProfile} style={{
          all: 'unset', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 9px', borderRadius: 9,
          color: theme.textFaint, fontSize: 12,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.025)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            border: `1px dashed ${theme.borderStrong}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="folder" size={12} strokeWidth={1.7} />
          </div>
          Import file
        </button>
      </div>

      <div style={{ borderTop: `0.5px solid ${theme.border}`, paddingTop: 14 }}>
        <div style={{
          padding: '0 8px 8px', fontSize: 9.5, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: theme.textFaint,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Pages · {active?.name}</span>
          <button onClick={onAddPage} title="Add page" style={{
            all: 'unset', cursor: 'pointer',
            width: 18, height: 18, borderRadius: 5,
            color: theme.textFaint,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; el.style.color = theme.text }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = 'transparent'; el.style.color = theme.textFaint }}>
            <Icon name="plus" size={10} strokeWidth={2} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {active?.pages.map((pg, i) => {
            const isActive = pg.id === activePageId
            return (
              <button key={pg.id} onClick={() => onPage(pg.id)} style={{
                all: 'unset', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 9px', borderRadius: 7,
                background: isActive
                  ? (theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)')
                  : 'transparent',
                color: isActive ? theme.text : theme.textMute,
                fontSize: 12,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 5,
                  fontSize: 9.5, fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isActive
                    ? `color-mix(in oklch, ${theme.accent} 22%, transparent)`
                    : (theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
                  color: isActive ? theme.accent : theme.textFaint,
                }}>{i + 1}</span>
                {pg.name}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 9, color: theme.textFaint, fontVariantNumeric: 'tabular-nums' }}>
                  {Object.keys(pg.slots).length}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{
        marginTop: 'auto', padding: '10px 8px 0',
        borderTop: `0.5px solid ${theme.border}`,
        fontSize: 10, color: theme.textFaint, lineHeight: 1.5,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'oklch(0.7 0.16 145)' }} />
          <span style={{ color: theme.textMute, fontWeight: 500 }}>Auto-saved locally</span>
        </div>
        <span>Press <kbd style={kbdStyle(theme)}>?</kbd> for shortcuts</span>
      </div>
    </Glass>
  )
}

function kbdStyle(theme: Theme): React.CSSProperties {
  return {
    display: 'inline-block', padding: '0 4px', borderRadius: 3,
    background: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    color: theme.textMute, fontSize: 9.5, fontFamily: 'ui-monospace,monospace',
    fontWeight: 600,
  }
}
