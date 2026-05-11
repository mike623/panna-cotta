import React, { useState, useEffect, useRef, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { invoke } from '@tauri-apps/api/core'
import { useDraggable } from '@dnd-kit/core'
import { Icon } from './icons'
import { ACTION_LIBRARY, QUICK_TEMPLATES, findAction } from './data'
import type { SlotData } from './data'
import type { QuickTemplate, ActionDef, ActionCategory } from './data'
import type { Theme } from './theme'
import { listPlugins, listInstalledApps } from './lib/invoke'
import type { PluginInfo } from './lib/types'

const PLUGIN_STATUS_COLOR: Record<PluginInfo['status'], string> = {
  running:     'oklch(0.7 0.16 145)',
  starting:    'oklch(0.75 0.16 80)',
  errored:     'oklch(0.6 0.18 25)',
  stopped:     'oklch(0.6 0.02 280)',
  not_spawned: 'oklch(0.6 0.02 280)',
}

// ── Action Palette ──────────────────────────────────────────────────────────
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
      data-testid={`template-${t.id}`}
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
      data-testid={`action-${a.id}`}
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

interface ActionPaletteProps {
  theme: Theme
  onTemplate: (t: { actionId: string; name: string; value: string; icon: string }) => void
}

export function ActionPalette({ theme, onTemplate }: ActionPaletteProps) {
  const [query, setQuery] = useState('')
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [pluginErr, setPluginErr] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    listPlugins()
      .then(ps => { if (!cancelled) setPlugins(ps) })
      .catch(e => { if (!cancelled) setPluginErr(String(e)) })
    return () => { cancelled = true }
  }, [])

  const pluginGroups: ActionCategory[] = useMemo(() => {
    return plugins.map(p => ({
      category: p.name,
      color: PLUGIN_STATUS_COLOR[p.status],
      actions: p.actions.map(a => ({
        id: a.uuid,
        name: a.name,
        icon: 'spark',
        hint: p.uuid,
      })),
    }))
  }, [plugins])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all: ActionCategory[] = [...ACTION_LIBRARY, ...pluginGroups]
    return all.map(cat => ({
      ...cat,
      actions: cat.actions.filter(a =>
        !q || a.name.toLowerCase().includes(q) || cat.category.toLowerCase().includes(q)
      ),
    })).filter(c => c.actions.length)
  }, [query, pluginGroups])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10, fontFamily: theme.font }}>
      <div style={{ position: 'relative' }}>
        <Icon name="search" size={13} style={{
          position: 'absolute', left: 10, top: '50%',
          transform: 'translateY(-50%)', color: theme.textFaint,
        }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search actions…"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 10px 8px 30px',
            background: theme.dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)',
            border: `0.5px solid ${theme.borderStrong}`,
            borderRadius: 9, color: theme.text, fontSize: 12,
            outline: 'none', fontFamily: theme.font,
          }}
        />
        <span style={{
          position: 'absolute', right: 8, top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 9.5, color: theme.textFaint,
          padding: '2px 5px', borderRadius: 4,
          background: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
        }}>⌘K</span>
      </div>

      <div>
        <div style={{
          fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: theme.textFaint,
          padding: '4px 4px 6px',
        }}>Quick add</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {QUICK_TEMPLATES.map(t => (
            <DraggableTemplate key={t.id} t={t} theme={theme} onTemplate={onTemplate} />
          ))}
        </div>
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        scrollbarWidth: 'thin', scrollbarColor: `${theme.borderStrong} transparent`,
        margin: '0 -4px', padding: '0 4px',
      }}>
        {groups.map(cat => (
          <div key={cat.category} style={{ marginBottom: 12 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: theme.textFaint,
              padding: '4px 4px 5px',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: cat.color }} />
              {cat.category}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {cat.actions.map(a => (
                <DraggableAction key={a.id} a={a} cat={cat} theme={theme} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        padding: '8px 4px 0', borderTop: `0.5px solid ${theme.border}`,
        fontSize: 10, color: theme.textFaint, lineHeight: 1.5,
      }}>
        Drag any action onto a slot, or click a slot to edit.
      </div>
    </div>
  )
}

// ── Inspector ───────────────────────────────────────────────────────────────
interface InspectorProps {
  slot: SlotData | undefined
  slotIdx: number
  theme: Theme
  onChange: (next: SlotData) => void
  onClear: () => void
  onClose: () => void
  onDuplicate: () => void
}

export function Inspector({ slot, slotIdx, theme, onChange, onClear, onClose, onDuplicate }: InspectorProps) {
  const action = slot ? findAction(slot.actionId) : null
  const [local, setLocal] = useState<SlotData>(slot || { actionId: 'open-url', label: '', value: '', iconOverride: '' })

  useEffect(() => {
    setLocal(slot || { actionId: 'open-url', label: '', value: '', iconOverride: '' })
  }, [slot, slotIdx])

  const [installedApps, setInstalledApps] = useState<string[] | null>(null)
  useEffect(() => {
    listInstalledApps()
      .then(apps => setInstalledApps(apps))
      .catch(() => setInstalledApps(null))
  }, [])

  const apply = (patch: Partial<SlotData>) => {
    const next = { ...local, ...patch }
    setLocal(next)
    onChange(next)
  }

  const ICON_SUGGESTIONS = ['globe','app','play','folder','spark','github','google','calc','code','chat','mail','calendar','sun','moon','lock','zap']

  return (
    <div data-testid="inspector" style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: theme.font, gap: 14 }}>
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
          <div data-testid="inspector-header" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: theme.textFaint }}>
            Slot {slotIdx + 1}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginTop: 1 }}>
            {slot ? local.label || '(no label)' : 'Empty slot'}
          </div>
        </div>
        <button data-testid="inspector-close" onClick={onClose} style={{ all: 'unset', cursor: 'pointer', padding: 6, borderRadius: 6, color: theme.textFaint }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
        <Field label="Type" theme={theme}>
          <select data-testid="inspector-type" value={local.actionId} onChange={e => apply({ actionId: e.target.value })} style={fieldStyle(theme)}>
            {ACTION_LIBRARY.map(cat => (
              <optgroup key={cat.category} label={cat.category}>
                {cat.actions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>

        <Field label="Label" theme={theme}>
          <input data-testid="inspector-label" value={local.label} onChange={e => apply({ label: e.target.value })}
            placeholder="GitHub" style={fieldStyle(theme)} />
        </Field>

        <Field label="Action value" theme={theme} hint={action?.hint}>
          {local.actionId === 'open-app' && installedApps && installedApps.length > 0 ? (
            <>
              <input data-testid="inspector-value" value={local.value || ''} onChange={e => apply({ value: e.target.value })}
                placeholder={action?.hint || ''} list="installed-apps-list" autoComplete="off" style={fieldStyle(theme)} />
              <datalist id="installed-apps-list">
                {installedApps.map(app => <option key={app} value={app} />)}
              </datalist>
            </>
          ) : (
            <input data-testid="inspector-value" value={local.value || ''} onChange={e => apply({ value: e.target.value })}
              placeholder={action?.hint || ''} style={fieldStyle(theme)} />
          )}
        </Field>

        <Field label="Icon (Lucide name)" theme={theme}>
          <input data-testid="inspector-icon" value={local.iconOverride || ''} onChange={e => apply({ iconOverride: e.target.value })}
            placeholder={action?.icon || 'spark'} style={fieldStyle(theme)} />
        </Field>

        <div>
          <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: theme.textFaint, marginBottom: 6 }}>
            Suggested icons
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
            {ICON_SUGGESTIONS.map(n => (
              <button key={n} onClick={() => apply({ iconOverride: n })} style={{
                all: 'unset', cursor: 'pointer', padding: 5, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: (local.iconOverride === n)
                  ? `color-mix(in oklch, ${theme.accent} 18%, transparent)`
                  : (theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
                color: (local.iconOverride === n) ? theme.accent : theme.textMute,
              }}>
                <Icon name={n} size={14} strokeWidth={1.7} />
              </button>
            ))}
          </div>
        </div>
      </div>

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

function Field({ label, hint, theme, children }: { label: string; hint?: string; theme: Theme; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: theme.textFaint }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 10, color: theme.textFaint }}>{hint}</span>}
    </label>
  )
}

function fieldStyle(theme: Theme): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box', padding: '7px 9px',
    background: theme.dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)',
    border: `0.5px solid ${theme.borderStrong}`,
    borderRadius: 8, color: theme.text, fontSize: 12,
    outline: 'none', fontFamily: theme.font,
  }
}

function btnStyle(theme: Theme, variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties {
  const map = {
    primary: { bg: theme.accent, color: 'white', border: theme.accent },
    ghost:   { bg: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', color: theme.text, border: theme.border },
    danger:  { bg: 'transparent', color: 'oklch(0.6 0.18 25)', border: 'oklch(0.6 0.18 25 / 0.4)' },
  }
  const v = map[variant]
  return {
    all: 'unset', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 10px', borderRadius: 7,
    background: v.bg, color: v.color, border: `0.5px solid ${v.border}`,
    fontSize: 11.5, fontWeight: 600, fontFamily: theme.font,
  }
}

// ── Settings Popover ─────────────────────────────────────────────────────────
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
    <div onMouseDown={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 50,
    }}>
      <div onMouseDown={e => e.stopPropagation()} style={{
        position: 'absolute', top: 46, right: 8, width: 240,
        background: theme.dark ? 'rgba(28,28,32,0.96)' : 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(40px) saturate(180%)',
        border: `0.5px solid ${theme.borderStrong}`,
        borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        fontFamily: theme.font, overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 14px 6px', borderBottom: `0.5px solid ${theme.border}` }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: theme.textFaint }}>
            Server
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: serverPort ? 'oklch(0.7 0.16 145)' : 'oklch(0.6 0.18 25)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: theme.textMute, fontFamily: 'ui-monospace, monospace' }}>
              {serverPort ? `localhost:${serverPort}` : 'Stopped'}
            </span>
          </div>
        </div>

        <div style={{ padding: '4px 0' }}>
          {row('Launch at Login', toggle(launchAtLogin, onToggleLaunchAtLogin))}
          {appVersion && row(
            'Version',
            <span style={{ fontSize: 11.5, color: theme.textFaint, fontFamily: 'ui-monospace, monospace' }}>
              v{appVersion}
            </span>
          )}
        </div>

        <div style={{ borderTop: `0.5px solid ${theme.border}`, padding: '4px 0' }}>
          <button
            onClick={() => invoke('open_log_folder').catch(() => {})}
            style={{
              all: 'unset', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', color: theme.textMute, fontSize: 12,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <Icon name="folder" size={13} strokeWidth={1.8} />
            Open Logs
          </button>
          <button onClick={onQuit} style={{
            all: 'unset', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 14px', color: 'oklch(0.6 0.18 25)', fontSize: 12,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'oklch(0.6 0.18 25 / 0.08)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
            <Icon name="power" size={13} strokeWidth={1.8} />
            Quit Panna Cotta
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toolbar ─────────────────────────────────────────────────────────────────
interface ToolbarProps {
  theme: Theme
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onConnect: () => void
  onShortcuts: () => void
  onCommand: () => void
  onReset: () => void
  profileName: string
  dirty: boolean
  dark: boolean
  onToggleDark: () => void
  serverPort?: number
  appVersion?: string
  launchAtLogin: boolean
  onToggleLaunchAtLogin: () => void
  onQuit: () => void
}

export function Toolbar({ theme, onUndo, onRedo, canUndo, canRedo, onConnect, onShortcuts, onCommand, onReset, profileName, dirty, dark, onToggleDark, serverPort, appVersion, launchAtLogin, onToggleLaunchAtLogin, onQuit }: ToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  const iconBtn = (icon: string, onClick: () => void, opts: { disabled?: boolean; title?: string; active?: boolean } = {}) => (
    <button onClick={onClick} disabled={opts.disabled} title={opts.title} style={{
      all: 'unset', cursor: opts.disabled ? 'default' : 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 28, borderRadius: 7,
      color: opts.disabled ? theme.textFaint : (opts.active ? theme.accent : theme.textMute),
      opacity: opts.disabled ? 0.4 : 1,
      transition: 'background .12s, color .12s',
    }}
    onMouseEnter={e => !opts.disabled && ((e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)')}
    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
      <Icon name={icon} size={14} strokeWidth={1.7} />
    </button>
  )

  const divider = <div style={{ width: 1, height: 16, background: theme.border, margin: '0 4px' }} />

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', height: 42, fontFamily: theme.font, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingRight: 10 }}>
        <div style={{
          width: 20, height: 20, borderRadius: 6,
          background: `linear-gradient(160deg, oklch(0.97 0.04 80) 0%, oklch(0.88 0.05 60) 50%, oklch(0.78 0.07 40) 100%)`,
          boxShadow: `0 0.5px 0 rgba(255,255,255,0.6) inset, 0 -1px 0 rgba(0,0,0,0.1) inset, 0 1px 2px rgba(0,0,0,0.15)`,
          position: 'relative',
        }}>
          <div style={{ position: 'absolute', top: 3, left: 4, width: 6, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.5)', filter: 'blur(0.5px)' }} />
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, letterSpacing: '-0.015em' }}>Panna Cotta</div>
      </div>

      {divider}

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

      <button onClick={onCommand} style={{
        all: 'unset', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '5px 7px 5px 10px', borderRadius: 8,
        background: theme.dark ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.65)',
        border: `0.5px solid ${theme.border}`,
        color: theme.textFaint, fontSize: 11.5, fontFamily: theme.font, minWidth: 220,
        boxShadow: `0 0.5px 0 ${theme.inset} inset`,
      }}>
        <Icon name="search" size={12} strokeWidth={1.8} />
        <span style={{ flex: 1, color: theme.textMute }}>Search or jump…</span>
        <span style={{ fontSize: 10, padding: '1.5px 5px', borderRadius: 4, background: theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)', color: theme.textFaint, fontWeight: 600 }}>⌘K</span>
      </button>

      <div style={{ flex: 1 }} />

      <span data-testid="save-status" data-dirty={dirty ? 'true' : 'false'} style={{
        fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
        padding: '3px 8px', borderRadius: 999,
        background: dirty
          ? 'color-mix(in oklch, oklch(0.7 0.15 60) 16%, transparent)'
          : 'color-mix(in oklch, oklch(0.7 0.16 145) 12%, transparent)',
        color: dirty ? 'oklch(0.7 0.15 60)' : 'oklch(0.66 0.14 145)',
        border: `0.5px solid ${dirty ? 'color-mix(in oklch, oklch(0.7 0.15 60) 30%, transparent)' : 'color-mix(in oklch, oklch(0.66 0.14 145) 30%, transparent)'}`,
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: dirty ? 'oklch(0.7 0.15 60)' : 'oklch(0.7 0.16 145)' }} />
        {dirty ? 'Saving' : 'Saved'}
      </span>

      {divider}

      {iconBtn('keyboard', onShortcuts, { title: 'Shortcuts (?)' })}
      {iconBtn(dark ? 'sun' : 'moon', onToggleDark, { title: 'Toggle theme' })}
      {iconBtn('qr', onConnect, { title: 'Connect device' })}
      {iconBtn('reset', onReset, { title: 'Reset' })}
      {iconBtn('settings', () => setSettingsOpen(o => !o), { title: 'Settings', active: settingsOpen })}

      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        serverPort={serverPort}
        appVersion={appVersion}
        launchAtLogin={launchAtLogin}
        onToggleLaunchAtLogin={onToggleLaunchAtLogin}
        onQuit={onQuit}
      />
    </div>
  )
}

// ── Command Palette ──────────────────────────────────────────────────────────
interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  theme: Theme
  onAction: (item: { kind: string; id: string; icon?: string; color?: string }) => void
}

export function CommandPalette({ open, onClose, theme, onAction }: CommandPaletteProps) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus() }, [open])
  useEffect(() => { if (!open) setQ('') }, [open])

  if (!open) return null

  const items = [
    { kind: 'cmd', id: 'undo',      label: 'Undo',                  hint: '⌘Z' },
    { kind: 'cmd', id: 'redo',      label: 'Redo',                  hint: '⌘⇧Z' },
    { kind: 'cmd', id: 'connect',   label: 'Show connect QR',       hint: '' },
    { kind: 'cmd', id: 'shortcuts', label: 'Keyboard shortcuts',    hint: '?' },
    ...ACTION_LIBRARY.flatMap(c => c.actions.map(a => ({
      kind: 'action', id: a.id, label: `Add ${a.name}`, hint: c.category, icon: a.icon, color: c.color,
    }))),
  ]
  const filtered = items.filter(i => !q || i.label.toLowerCase().includes(q.toLowerCase()) || (i.hint||'').toLowerCase().includes(q.toLowerCase()))

  return (
    <div onMouseDown={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: 80,
    }}>
      <div data-testid="command-palette" onMouseDown={e => e.stopPropagation()} style={{
        width: 460,
        background: theme.dark ? 'rgba(28,28,32,0.92)' : 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(40px) saturate(180%)',
        border: `0.5px solid ${theme.borderStrong}`,
        borderRadius: 14, boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
        overflow: 'hidden', fontFamily: theme.font,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `0.5px solid ${theme.border}` }}>
          <Icon name="search" size={14} color={theme.textFaint} />
          <input ref={inputRef} data-testid="command-palette-input" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Type a command or action…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: theme.text, fontSize: 14, fontFamily: theme.font }} />
          <span style={{ fontSize: 10, color: theme.textFaint, padding: '2px 5px', borderRadius: 4, background: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>esc</span>
        </div>
        <div data-testid="command-palette-results" style={{ maxHeight: 320, overflowY: 'auto', padding: 6 }}>
          {filtered.slice(0, 30).map((it, i) => (
            <button key={i} data-testid={`command-item-${it.kind}-${it.id}`} onClick={() => { onAction(it); onClose() }} style={{
              all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 8, width: '100%', boxSizing: 'border-box',
              color: theme.text, fontSize: 12.5,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
              <div style={{
                width: 22, height: 22, borderRadius: 6,
                background: it.color ? `color-mix(in oklch, ${it.color} 18%, transparent)` : (theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'),
                color: it.color || theme.textMute,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
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
interface ConnectPopoverProps {
  open: boolean
  onClose: () => void
  theme: Theme
  lanUrl?: string
}

export function ConnectPopover({ open, onClose, theme, lanUrl }: ConnectPopoverProps) {
  if (!open) return null

  return (
    <div onMouseDown={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 40,
      background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onMouseDown={e => e.stopPropagation()} style={{
        width: 320, padding: 22,
        background: theme.dark ? 'rgba(28,28,32,0.92)' : 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(40px) saturate(180%)',
        border: `0.5px solid ${theme.borderStrong}`,
        borderRadius: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
        fontFamily: theme.font, color: theme.text, textAlign: 'center',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Connect a device</div>
        <div style={{ fontSize: 11.5, color: theme.textMute, marginBottom: 16 }}>
          Open on your phone or tablet and scan to pair.
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {lanUrl ? (
            <QRCodeSVG
              value={lanUrl}
              size={200}
              bgColor="white"
              fgColor="black"
              level="M"
              style={{ borderRadius: 10 }}
            />
          ) : (
            <div style={{
              width: 200, height: 200, borderRadius: 10,
              background: theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, color: theme.textFaint,
            }}>
              Waiting for server…
            </div>
          )}
        </div>
        {lanUrl && (
          <div style={{ marginTop: 14, fontSize: 11, color: theme.textMute, fontFamily: 'ui-monospace, monospace' }}>
            {lanUrl}
          </div>
        )}
        <button onClick={onClose} style={{
          all: 'unset', cursor: 'pointer', marginTop: 14,
          padding: '7px 14px', borderRadius: 8,
          background: theme.accent, color: 'white', fontSize: 12, fontWeight: 600,
        }}>Done</button>
      </div>
    </div>
  )
}

// ── Shortcuts Overlay ─────────────────────────────────────────────────────────
interface ShortcutsOverlayProps {
  open: boolean
  onClose: () => void
  theme: Theme
}

export function ShortcutsOverlay({ open, onClose, theme }: ShortcutsOverlayProps) {
  if (!open) return null
  const Kbd = ({ children }: { children: React.ReactNode }) => (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 5,
      fontSize: 10.5, fontWeight: 600, fontFamily: 'ui-monospace, monospace',
      background: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      border: `0.5px solid ${theme.border}`, color: theme.textMute,
    }}>{children}</span>
  )
  const rows = [
    ['⌘K',     'Command palette'],
    ['⌘Z',     'Undo'],
    ['⌘⇧Z',    'Redo'],
    ['1..9',   'Select slot by index'],
    ['Delete', 'Clear selected slot'],
    ['?',      'Toggle this overlay'],
    ['Esc',    'Close overlay / deselect'],
  ]
  return (
    <div onMouseDown={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div data-testid="shortcuts-overlay" onMouseDown={e => e.stopPropagation()} style={{
        width: 360, padding: 22,
        background: theme.dark ? 'rgba(28,28,32,0.92)' : 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(40px) saturate(180%)',
        border: `0.5px solid ${theme.borderStrong}`,
        borderRadius: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
        fontFamily: theme.font, color: theme.text,
      }}>
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
