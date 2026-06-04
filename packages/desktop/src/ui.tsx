import React, { useState, useEffect, useRef, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { invoke } from '@tauri-apps/api/core'
import { Icon } from './icons'
import { ACTION_LIBRARY, QUICK_TEMPLATES, findAction } from './data'
import type { SlotData } from './data'
import type { QuickTemplate, ActionDef, ActionCategory } from './data'
import type { Theme } from './theme'
import { listInstalledApps, listPlugins } from './lib/invoke'
import type { PluginInfo } from './lib/types'

function fieldStyle(theme: Theme): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box', padding: '7px 9px',
    background: theme.dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)',
    border: `0.5px solid ${theme.borderStrong}`,
    borderRadius: 8, color: theme.text, fontSize: 12,
    outline: 'none', fontFamily: theme.font,
  } as React.CSSProperties
}

function btnStyle(theme: Theme, variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties {
  const map = {
    primary: { bg: theme.accent, color: 'white',                           border: theme.accent },
    ghost:   { bg: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', color: theme.text,  border: theme.border },
    danger:  { bg: 'transparent', color: 'oklch(0.6 0.18 25)',             border: 'oklch(0.6 0.18 25 / 0.4)' },
  }
  const v = map[variant]
  return {
    all: 'unset', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 10px', borderRadius: 7,
    background: v.bg, color: v.color,
    border: `0.5px solid ${v.border}`,
    fontSize: 11.5, fontWeight: 600, fontFamily: theme.font,
  } as React.CSSProperties
}

// ── Action Palette ──────────────────────────────────────────────────────────

export function ActionPalette({ theme, onTemplate }: { theme: Theme, onTemplate: (t: QuickTemplate) => void }) {
  const [query, setQuery] = useState('')
  const [plugins, setPlugins] = useState<PluginInfo[]>([])

  useEffect(() => {
    listPlugins().then(setPlugins).catch(() => {})
  }, [])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ACTION_LIBRARY.map(cat => ({
      ...cat,
      actions: cat.actions.filter(a =>
        !q || a.name.toLowerCase().includes(q) || cat.category.toLowerCase().includes(q)
      ),
    })).filter(c => c.actions.length)
  }, [query])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10, fontFamily: theme.font }}>
      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.textFaint } as React.CSSProperties} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search actions…"
          style={{ width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px 8px 30px',
            background: theme.dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)',
            border: `0.5px solid ${theme.borderStrong}`, borderRadius: 9,
            color: theme.text, fontSize: 12, outline: 'none', fontFamily: theme.font }} />
      </div>

      {/* Quick add */}
      <div>
        <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: theme.textFaint, padding: '4px 4px 6px' }}>Quick add</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {QUICK_TEMPLATES.map(t => (
            <button key={t.id}
              draggable
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'copy'
                e.dataTransfer.setData('application/x-panna', JSON.stringify({ type: 'action', actionId: t.actionId, name: t.name, value: t.value, iconOverride: t.icon }))
              }}
              onClick={() => onTemplate(t)}
              data-testid={`template-${t.id}`}
              style={{ all: 'unset' as const, cursor: 'grab', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4, padding: '8px 4px', background: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)', border: `0.5px solid ${theme.border}`, borderRadius: 8, fontSize: 10.5, color: theme.text, textAlign: 'center' as const }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)'}>
              <Icon name={t.icon} size={16} color={theme.textMute} strokeWidth={1.7} />
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Library */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'thin' as const, scrollbarColor: `${theme.borderStrong} transparent`, margin: '0 -4px', padding: '0 4px' }}>
        {groups.map(cat => (
          <div key={cat.category} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: theme.textFaint, padding: '4px 4px 5px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: cat.color }} />
              {cat.category}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {cat.actions.map((a: ActionDef) => (
                <div key={a.id} draggable
                  data-testid={`action-${a.id}`}
                  onDragStart={e => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/x-panna', JSON.stringify({ type: 'action', actionId: a.id, name: a.name, value: a.hint || '' })) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 7px', borderRadius: 7, cursor: 'grab', color: theme.text, fontSize: 12, transition: 'background .12s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: `color-mix(in oklch, ${cat.color} 18%, transparent)`, color: cat.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={a.icon} size={13} strokeWidth={1.8} />
                  </div>
                  <span style={{ flex: 1 }}>{a.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {plugins.filter(p => p.actions && p.actions.length > 0).map(p => (
          <div key={p.uuid} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: theme.textFaint, padding: '4px 4px 5px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: theme.accent }} />
              {p.name}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {p.actions.map(a => (
                <div key={a.uuid} draggable
                  data-testid={`action-${a.uuid}`}
                  onDragStart={e => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/x-panna', JSON.stringify({ type: 'action', actionId: a.uuid, name: a.name, value: '' })) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 7px', borderRadius: 7, cursor: 'grab', color: theme.text, fontSize: 12, transition: 'background .12s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: `color-mix(in oklch, ${theme.accent} 18%, transparent)`, color: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="spark" size={13} strokeWidth={1.8} />
                  </div>
                  <span style={{ flex: 1 }}>{a.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 4px 0', borderTop: `0.5px solid ${theme.border}`, fontSize: 10, color: theme.textFaint, lineHeight: 1.5 }}>
        Drag any action onto a slot, or click a slot to edit.
      </div>
    </div>
  )
}

// ── Inspector ───────────────────────────────────────────────────────────────

export function Inspector({ slot, slotIdx, theme, onChange, onClear, onClose, onDuplicate }: {
  slot: SlotData | undefined
  slotIdx: number
  theme: Theme
  onChange: (next: SlotData) => void
  onClear: () => void
  onClose: () => void
  onDuplicate: () => void
}) {
  const action = slot ? findAction(slot.actionId) : null
  const [local, setLocal] = useState<SlotData>(slot || { actionId: 'open-url', label: '', value: '', iconOverride: '' })
  const [installedApps, setInstalledApps] = useState<string[] | null>(null)

  useEffect(() => {
    setLocal(slot || { actionId: 'open-url', label: '', value: '', iconOverride: '' })
  }, [slot, slotIdx])

  useEffect(() => {
    listInstalledApps().then(apps => setInstalledApps(apps)).catch(() => setInstalledApps(null))
  }, [])

  const apply = (patch: Partial<SlotData>) => {
    const next = { ...local, ...patch }
    setLocal(next)
    onChange(next)
  }

  return (
    <div data-testid="inspector" style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: theme.font, gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
          border: action ? `1px solid ${theme.border}` : `1px dashed ${theme.borderStrong}`,
          color: action ? (action.color || theme.accent) : theme.textFaint,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {action && <Icon name={local.iconOverride || action.icon} size={20} strokeWidth={1.6} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div data-testid="inspector-header" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: theme.textFaint }}>Slot {slotIdx + 1}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginTop: 1 }}>{slot ? local.label || '(no label)' : 'Empty slot'}</div>
        </div>
        <button data-testid="inspector-close" onClick={onClose} style={{ all: 'unset' as const, cursor: 'pointer', padding: 6, borderRadius: 6, color: theme.textFaint }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}>
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
        {/* Type */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: theme.textFaint }}>Type</span>
          <select data-testid="inspector-type" value={local.actionId} onChange={e => apply({ actionId: e.target.value })} style={fieldStyle(theme) as React.CSSProperties}>
            {ACTION_LIBRARY.map(cat => (
              <optgroup key={cat.category} label={cat.category}>
                {cat.actions.map((a: ActionDef) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>

        {/* Label */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: theme.textFaint }}>Label</span>
          <input data-testid="inspector-label" value={local.label} onChange={e => apply({ label: e.target.value })}
            placeholder="GitHub" style={fieldStyle(theme) as React.CSSProperties} />
        </label>

        {/* Action value */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: theme.textFaint }}>Action value</span>
          {local.actionId === 'open-app' && installedApps && installedApps.length > 0 ? (
            <>
              <input data-testid="inspector-value" value={local.value || ''} onChange={e => apply({ value: e.target.value })}
                placeholder={action?.hint || ''} list="installed-apps-list" autoComplete="off" style={fieldStyle(theme) as React.CSSProperties} />
              <datalist id="installed-apps-list">
                {installedApps.map(a => <option key={a} value={a} />)}
              </datalist>
            </>
          ) : (
            <input data-testid="inspector-value" value={local.value || ''} onChange={e => apply({ value: e.target.value })}
              placeholder={action?.hint || ''} style={fieldStyle(theme) as React.CSSProperties} />
          )}
          {action?.hint && <span style={{ fontSize: 10, color: theme.textFaint }}>{action.hint}</span>}
        </label>

        {/* Icon override */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: theme.textFaint }}>Icon (name)</span>
          <input data-testid="inspector-icon" value={local.iconOverride || ''} onChange={e => apply({ iconOverride: e.target.value })}
            placeholder={action?.icon || 'spark'} style={fieldStyle(theme) as React.CSSProperties} />
        </label>

        {/* Icon picker */}
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: theme.textFaint, marginBottom: 6 }}>Suggested icons</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
            {['globe','app','play','folder','spark','github','google','calc','code','chat','mail','calendar','sun','moon','lock','zap'].map(n => (
              <button key={n} onClick={() => apply({ iconOverride: n })} style={{
                all: 'unset' as const, cursor: 'pointer', padding: 5, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: local.iconOverride === n
                  ? `color-mix(in oklch, ${theme.accent} 18%, transparent)`
                  : (theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
                color: local.iconOverride === n ? theme.accent : theme.textMute,
              }}>
                <Icon name={n} size={14} strokeWidth={1.7} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div style={{ display: 'flex', gap: 6, paddingTop: 10, borderTop: `0.5px solid ${theme.border}` }}>
        <button data-testid="inspector-duplicate" onClick={onDuplicate} style={btnStyle(theme, 'ghost')}>
          <Icon name="copy" size={12} /> Duplicate
        </button>
        <div style={{ flex: 1 }} />
        <button data-testid="inspector-clear" onClick={onClear} style={btnStyle(theme, 'danger')}>
          <Icon name="trash" size={12} /> Clear
        </button>
      </div>
    </div>
  )
}

// ── Toolbar ─────────────────────────────────────────────────────────────────

// Sara SVG mark (inline — no external deps)
function SaraMark({ size = 22, accent }: { size?: number, accent: string }) {
  const G = [35, 50, 65]
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <rect width="100" height="100" rx="24" fill="#EFE7D6" />
      <circle cx="50" cy="50" r="31" fill="#F6F1E8" stroke="#211F1B" strokeOpacity="0.16" strokeWidth="1.4" />
      <circle cx="50" cy="50" r="24" fill="none" stroke="#211F1B" strokeOpacity="0.10" strokeWidth="1" />
      {G.flatMap((y, ri) => G.map((x, ci) => {
        const active = ri === 1 && ci === 1
        return <circle key={`${ri}-${ci}`} cx={x} cy={y} r={active ? 4.8 : 3.8} fill={active ? accent : '#211F1B'} fillOpacity={active ? 1 : 0.82} />
      }))}
    </svg>
  )
}

export function Toolbar({ theme, onUndo, onRedo, canUndo, canRedo, onConnect, onShortcuts, onCommand, onReset, profileName, dirty, dark, onToggleDark, serverPort, appVersion, launchAtLogin, onToggleLaunchAtLogin, onQuit }: {
  theme: Theme, onUndo: () => void, onRedo: () => void, canUndo: boolean, canRedo: boolean,
  onConnect: () => void, onShortcuts: () => void, onCommand: () => void, onReset: () => void,
  profileName: string, dirty: boolean, dark: boolean, onToggleDark: () => void,
  serverPort?: number
  appVersion?: string
  launchAtLogin?: boolean
  onToggleLaunchAtLogin?: () => void
  onQuit?: () => void
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const iconBtn = (icon: string, onClick: () => void, opts: { disabled?: boolean, title?: string, active?: boolean } = {}) => (
    <button onClick={onClick} disabled={opts.disabled} title={opts.title} style={{
      all: 'unset', cursor: opts.disabled ? 'default' : 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 28, borderRadius: 7,
      color: opts.disabled ? theme.textFaint : (opts.active ? theme.accent : theme.textMute),
      opacity: opts.disabled ? 0.4 : 1, transition: 'background .12s, color .12s',
    }}
    onMouseEnter={e => !opts.disabled && ((e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)')}
    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}>
      <Icon name={icon} size={14} strokeWidth={1.7} />
    </button>
  )
  const divider = <div style={{ width: 1, height: 16, background: theme.border, margin: '0 4px' }} />

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', height: 42, fontFamily: theme.font }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingRight: 10 }}>
        <SaraMark size={22} accent={theme.accent} />
        <div style={{ fontFamily: theme.fontSerif, fontSize: 15, fontWeight: 600, color: theme.text, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
          Panna Cotta
        </div>
      </div>
      {divider}
      {/* Profile chip */}
      <button onClick={onCommand} style={{
        all: 'unset', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 9px 4px 8px', borderRadius: 7,
        background: theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
        color: theme.text, fontSize: 11.5, fontWeight: 600,
        border: `0.5px solid ${theme.border}`,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: theme.accent }} />
        {profileName}
        <Icon name="arrowD" size={10} color={theme.textFaint} strokeWidth={2} />
      </button>
      {divider}
      {iconBtn('undo', onUndo, { disabled: !canUndo, title: 'Undo (⌘Z)' })}
      {iconBtn('redo', onRedo, { disabled: !canRedo, title: 'Redo (⌘⇧Z)' })}
      <div style={{ flex: 1 }} />
      {/* ⌘K search bar */}
      <button onClick={onCommand} style={{
        all: 'unset', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '5px 7px 5px 10px', borderRadius: 8,
        background: theme.dark ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.65)',
        border: `0.5px solid ${theme.border}`, color: theme.textFaint,
        fontSize: 11.5, fontFamily: theme.font, minWidth: 220,
        boxShadow: `0 0.5px 0 ${theme.inset} inset`,
      }}>
        <Icon name="search" size={12} strokeWidth={1.8} />
        <span style={{ flex: 1, color: theme.textMute }}>Search or jump…</span>
        <span style={{ fontSize: 10, padding: '1.5px 5px', borderRadius: 4, background: theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)', color: theme.textFaint, fontWeight: 600 }}>⌘K</span>
      </button>
      <div style={{ flex: 1 }} />
      {/* Save status */}
      <span data-testid="save-status" data-dirty={dirty ? 'true' : 'false'} style={{
        fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
        padding: '3px 8px', borderRadius: 999,
        background: dirty ? 'color-mix(in oklch, oklch(0.66 0.11 70) 15%, transparent)' : `color-mix(in oklch, ${theme.matcha} 13%, transparent)`,
        color: dirty ? 'oklch(0.6 0.11 70)' : theme.matcha,
        border: `0.5px solid ${dirty ? 'color-mix(in oklch, oklch(0.6 0.11 70) 30%, transparent)' : `color-mix(in oklch, ${theme.matcha} 30%, transparent)`}`,
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: dirty ? 'oklch(0.62 0.11 70)' : theme.matcha }} />
        {dirty ? 'Saving' : 'Saved'}
      </span>
      {divider}
      {iconBtn('keyboard', onShortcuts, { title: 'Shortcuts (?)' })}
      {iconBtn(dark ? 'sun' : 'moon', onToggleDark, { title: 'Toggle theme' })}
      {iconBtn('qr', onConnect, { title: 'Connect device' })}
      {iconBtn('reset', onReset, { title: 'Reset' })}
      {iconBtn('settings', () => setSettingsOpen(v => !v), { title: 'Settings', active: settingsOpen })}
      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        serverPort={serverPort}
        appVersion={appVersion}
        launchAtLogin={launchAtLogin ?? false}
        onToggleLaunchAtLogin={onToggleLaunchAtLogin ?? (() => {})}
        onQuit={onQuit ?? (() => {})}
      />
    </div>
  )
}

// ── Command Palette ──────────────────────────────────────────────────────────

export function CommandPalette({ open, onClose, theme, onAction }: {
  open: boolean, onClose: () => void, theme: Theme,
  onAction: (it: { kind: string, id: string, label: string, icon?: string, color?: string }) => void
}) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus() }, [open])

  const items = useMemo(() => [
    { kind: 'cmd', id: 'undo',      label: 'Undo',                  hint: '⌘Z' },
    { kind: 'cmd', id: 'redo',      label: 'Redo',                  hint: '⌘⇧Z' },
    { kind: 'cmd', id: 'connect',   label: 'Show connect QR',       hint: '' },
    { kind: 'cmd', id: 'shortcuts', label: 'Keyboard shortcuts',    hint: '?' },
    { kind: 'cmd', id: 'theme',     label: 'Toggle dark mode',      hint: '' },
    ...ACTION_LIBRARY.flatMap((c: ActionCategory) => c.actions.map((a: ActionDef) => ({
      kind: 'action', id: a.id, label: `Add ${a.name}`, hint: c.category, icon: a.icon, color: c.color,
    }))),
  ], [])

  const filtered = useMemo(() =>
    items.filter(i => !q || i.label.toLowerCase().includes(q.toLowerCase()) || (i.hint || '').toLowerCase().includes(q.toLowerCase())),
    [items, q]
  )

  if (!open) return null

  return (
    <div onMouseDown={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80 }}>
      <div data-testid="command-palette" onMouseDown={e => e.stopPropagation()} style={{ width: 460, background: theme.dark ? 'rgba(29,31,36,0.94)' : 'rgba(246,241,232,0.95)', backdropFilter: 'blur(40px) saturate(180%)', border: `0.5px solid ${theme.borderStrong}`, borderRadius: 14, boxShadow: '0 30px 80px rgba(0,0,0,0.4)', overflow: 'hidden', fontFamily: theme.font }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `0.5px solid ${theme.border}` }}>
          <Icon name="search" size={14} color={theme.textFaint} />
          <input ref={inputRef} data-testid="command-palette-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Type a command or action…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: theme.text, fontSize: 14, fontFamily: theme.font }} />
          <span style={{ fontSize: 10, color: theme.textFaint, padding: '2px 5px', borderRadius: 4, background: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>esc</span>
        </div>
        <div data-testid="command-palette-results" style={{ maxHeight: 320, overflowY: 'auto', padding: 6 }}>
          {filtered.slice(0, 30).map((it) => (
            <button key={`${it.kind}-${it.id}`} data-testid={`command-item-${it.kind}-${it.id}`} onClick={() => { onAction(it); onClose() }} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, width: '100%', boxSizing: 'border-box', color: theme.text, fontSize: 12.5 }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: it.color ? `color-mix(in oklch, ${it.color} 18%, transparent)` : (theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'), color: it.color || theme.textMute, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={it.icon || (it.kind === 'cmd' ? 'cmd' : 'spark')} size={12} />
              </div>
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.hint && <span style={{ fontSize: 10.5, color: theme.textFaint }}>{it.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Connect Popover ──────────────────────────────────────────────────────────

export function ConnectPopover({ open, onClose, theme, url, lanUrl }: {
  open: boolean, onClose: () => void, theme: Theme,
  url?: string, lanUrl?: string
}) {
  if (!open) return null
  const displayUrl = url || lanUrl || ''
  return (
    <div onMouseDown={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onMouseDown={e => e.stopPropagation()} style={{ width: 320, padding: 22, background: theme.dark ? 'rgba(29,31,36,0.94)' : 'rgba(246,241,232,0.95)', backdropFilter: 'blur(40px) saturate(180%)', border: `0.5px solid ${theme.borderStrong}`, borderRadius: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.4)', fontFamily: theme.font, color: theme.text, textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Connect a device</div>
        <div style={{ fontSize: 11.5, color: theme.textMute, marginBottom: 16 }}>Scan to open the panel on your phone or tablet.</div>
        {displayUrl && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <QRCodeSVG value={displayUrl} size={180} bgColor="white" fgColor="black" style={{ borderRadius: 10, padding: 10, background: 'white' }} />
          </div>
        )}
        <div style={{ marginBottom: 14, fontSize: 11, color: theme.textMute, fontFamily: 'ui-monospace, monospace' }}>{displayUrl}</div>
        <button onClick={onClose} style={{ all: 'unset', cursor: 'pointer', padding: '7px 14px', borderRadius: 8, background: theme.accent, color: 'white', fontSize: 12, fontWeight: 600 }}>Done</button>
      </div>
    </div>
  )
}

// ── Shortcuts Overlay ─────────────────────────────────────────────────────────

export function ShortcutsOverlay({ open, onClose, theme }: { open: boolean, onClose: () => void, theme: Theme }) {
  if (!open) return null
  const Kbd = ({ children }: { children: React.ReactNode }) => (
    <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, fontFamily: 'ui-monospace, monospace', background: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', border: `0.5px solid ${theme.border}`, color: theme.textMute }}>{children}</span>
  )
  const rows: [string, string][] = [
    ['⌘K', 'Command palette'], ['⌘Z', 'Undo'], ['⌘⇧Z', 'Redo'],
    ['1..9', 'Select slot by index'], ['Enter', 'Edit selected slot'],
    ['Delete', 'Clear selected slot'], ['?', 'Toggle shortcuts'], ['Esc', 'Close / deselect'],
  ]
  return (
    <div onMouseDown={onClose} style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div data-testid="shortcuts-overlay" onMouseDown={e => e.stopPropagation()} style={{ width: 360, padding: 22, background: theme.dark ? 'rgba(29,31,36,0.94)' : 'rgba(246,241,232,0.95)', backdropFilter: 'blur(40px) saturate(180%)', border: `0.5px solid ${theme.borderStrong}`, borderRadius: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.4)', fontFamily: theme.font, color: theme.text }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Keyboard shortcuts</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '9px 14px', alignItems: 'center' }}>
          {rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <Kbd>{k}</Kbd>
              <span style={{ fontSize: 12, color: theme.textMute }}>{v}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Stepper ──────────────────────────────────────────────────────────────────

export function Stepper({ label, value, onChange, min, max, theme }: { label: string, value: number, onChange: (v: number) => void, min: number, max: number, theme: Theme }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, background: theme.dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)', border: `0.5px solid ${theme.borderStrong}`, borderRadius: 7, overflow: 'hidden' }}>
      <span style={{ padding: '0 6px', fontSize: 10, fontWeight: 600, color: theme.textFaint, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>{label}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} style={{ all: 'unset', cursor: 'pointer', padding: '4px 6px', color: theme.textMute, display: 'flex', alignItems: 'center' }}>
        <Icon name="minus" size={11} />
      </button>
      <span style={{ padding: '0 8px', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 11, color: theme.text }}>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} style={{ all: 'unset', cursor: 'pointer', padding: '4px 6px', color: theme.textMute, display: 'flex', alignItems: 'center' }}>
        <Icon name="plus" size={11} />
      </button>
    </div>
  )
}

// ── Settings Popover ──────────────────────────────────────────────────────────
// Kept for backward compatibility with PannaApp.tsx until Task 7 removes it.

interface SettingsPopoverProps {
  open: boolean
  onClose: () => void
  theme: Theme
  serverPort?: number
  appVersion?: string
  launchAtLogin: boolean
  onToggleLaunchAtLogin: () => void
  onQuit: () => void
}

export function SettingsPopover({ open, onClose, theme, serverPort, appVersion, launchAtLogin, onToggleLaunchAtLogin, onQuit }: SettingsPopoverProps) {
  if (!open) return null

  const row = (label: string, right: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', gap: 20 }}>
      <span style={{ fontSize: 12, color: theme.text }}>{label}</span>
      {right}
    </div>
  )

  const toggle = (checked: boolean, onChange: () => void) => (
    <div onClick={onChange} style={{
      width: 32, height: 18, borderRadius: 999, cursor: 'pointer',
      background: checked ? theme.accent : (theme.dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)'),
      position: 'relative', transition: 'background .18s', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: 'white',
        transition: 'left .18s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  )

  return (
    <div onMouseDown={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50 }}>
      <div onMouseDown={e => e.stopPropagation()} style={{
        position: 'absolute', top: 46, right: 8, width: 240,
        background: theme.dark ? 'rgba(28,28,32,0.96)' : 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(40px) saturate(180%)',
        border: `0.5px solid ${theme.borderStrong}`,
        borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        fontFamily: theme.font, overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 14px 6px', borderBottom: `0.5px solid ${theme.border}` }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: theme.textFaint }}>Server</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: serverPort ? 'oklch(0.7 0.16 145)' : 'oklch(0.6 0.18 25)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: theme.textMute, fontFamily: 'ui-monospace, monospace' }}>
              {serverPort ? `localhost:${serverPort}` : 'Stopped'}
            </span>
          </div>
        </div>
        <div style={{ padding: '4px 0' }}>
          {row('Launch at Login', toggle(launchAtLogin, onToggleLaunchAtLogin))}
          {appVersion && row('Version', <span style={{ fontSize: 11.5, color: theme.textFaint, fontFamily: 'ui-monospace, monospace' }}>v{appVersion}</span>)}
        </div>
        <div style={{ borderTop: `0.5px solid ${theme.border}`, padding: '4px 0' }}>
          <button
            onClick={() => invoke('open_log_folder').catch(() => {})}
            style={{ all: 'unset', cursor: 'pointer', width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', color: theme.textMute, fontSize: 12 }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}>
            <Icon name="folder" size={13} strokeWidth={1.8} />
            Open Logs
          </button>
          <button onClick={onQuit} style={{ all: 'unset', cursor: 'pointer', width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', color: 'oklch(0.6 0.18 25)', fontSize: 12 }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'oklch(0.6 0.18 25 / 0.08)'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}>
            <Icon name="power" size={13} strokeWidth={1.8} />
            Quit Panna Cotta
          </button>
        </div>
      </div>
    </div>
  )
}
