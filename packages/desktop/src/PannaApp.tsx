import React, { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { makeTheme, DEFAULT_TWEAKS } from './theme'
import type { Tweaks } from './theme'
import { findAction, makeInitialProfiles } from './data'
import type { ProfileData, SlotData } from './data'
import { backendToProfile, profileToBackend } from './bridge'
import type { BackendConfig, BackendProfile } from './bridge'
import { Glass, DeviceCanvas, ProfilesRail } from './core'
import { ActionPalette, Inspector, Toolbar, CommandPalette, ConnectPopover, ShortcutsOverlay, Stepper } from './ui'
import { Icon } from './icons'
import { useHistory } from './lib/useHistory'
import { AutocompleteSettings } from './AutocompleteSettings'

// ── Tauri bridge types ───────────────────────────────────────────────────────
interface ServerInfo {
  ip: string
  port: number
}

// ── App state history type ───────────────────────────────────────────────────
interface AppSnapshot {
  profiles: ProfileData[]
  activeProfileId: string
  activePageId: string
}

// ── PannaApp ─────────────────────────────────────────────────────────────────
export function PannaApp() {
  // Theme
  const [tweaks, setTweaksRaw] = useState<Tweaks>(() => {
    try {
      const stored = localStorage.getItem('panna-tweaks')
      const t = stored ? { ...DEFAULT_TWEAKS, ...JSON.parse(stored) } : DEFAULT_TWEAKS
      localStorage.setItem('pc.theme', t.dark ? 'dark' : 'light')
      return t
    } catch { return DEFAULT_TWEAKS }
  })
  const setTweak = <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setTweaksRaw(prev => {
      const next = { ...prev, [key]: value }
      localStorage.setItem('panna-tweaks', JSON.stringify(next))
      if (key === 'dark') {
        localStorage.setItem('pc.theme', value ? 'dark' : 'light')
      }
      return next
    })
  }
  const theme = makeTheme(tweaks)

  // Undo/redo history (extracted into a hook so it can be unit-tested)
  const {
    state,
    hIdx,
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    reset: resetHistory,
  } = useHistory<AppSnapshot>({
    profiles: makeInitialProfiles(),
    activeProfileId: 'Default',
    activePageId: 'p1',
  })

  // UI state
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const [rightView, setRightView] = useState<'palette' | 'inspector'>('palette')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [lanUrl, setLanUrl] = useState<string>('')
  const [serverPort, setServerPort] = useState<number | undefined>()
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [appVersion, setAppVersion] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Derived
  const activeProfile = state.profiles.find(p => p.id === state.activeProfileId)!
  const activePage = activeProfile?.pages.find(pg => pg.id === state.activePageId) || activeProfile?.pages[0]

  // ── Load from Tauri on mount ─────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [tauriProfiles, tauriConfig, serverInfo, autostart, version] = await Promise.all([
          invoke<BackendProfile[]>('list_profiles_cmd'),
          invoke<BackendConfig>('get_config'),
          invoke<ServerInfo>('get_server_info').catch(() => null),
          invoke<boolean>('get_autostart').catch(() => false),
          invoke<string>('get_app_version').catch(() => ''),
        ])

        if (serverInfo) {
          setLanUrl(`http://${serverInfo.ip}:${serverInfo.port}/apps/`)
          setServerPort(serverInfo.port)
        }
        setLaunchAtLogin(autostart)
        setAppVersion(version)

        const activeBackend = tauriProfiles.find(p => p.isActive)?.name || tauriProfiles[0]?.name || 'Default'

        // Build initial profiles: active profile gets real config, others get defaults
        const profiles: ProfileData[] = tauriProfiles.map(tp => {
          if (tp.name === activeBackend) {
            return backendToProfile(tp.name, tauriConfig)
          }
          return { id: tp.name, name: tp.name, icon: 'home', rows: 3, cols: 3, pages: [{ id: 'p1', name: 'Home', slots: {} }] }
        })

        if (profiles.length === 0) profiles.push(...makeInitialProfiles())

        const initialState: AppSnapshot = {
          profiles,
          activeProfileId: activeBackend,
          activePageId: 'p1',
        }
        resetHistory(initialState)
      } catch (err) {
        console.warn('Tauri not available, using defaults:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Auto-save active profile to Tauri (debounced) ─────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (loading) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const profile = state.profiles.find(p => p.id === state.activeProfileId)
        if (!profile) return
        const config = profileToBackend(profile, state.activePageId)
        await invoke('save_config', { config })
      } catch (err) {
        console.warn('Save failed:', err)
      }
    }, 600)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [state, loading])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const updateActivePage = (mut: (pg: ProfileData['pages'][0]) => ProfileData['pages'][0]) => {
    commit(cur => ({
      ...cur,
      profiles: cur.profiles.map(p =>
        p.id !== cur.activeProfileId ? p : {
          ...p,
          pages: p.pages.map(pg => pg.id !== cur.activePageId ? pg : mut(pg)),
        }
      ),
    }))
    setDirty(true)
    setTimeout(() => setDirty(false), 1200)
  }

  // ── Slot ops ──────────────────────────────────────────────────────────────
  const onSlotClick = (idx: number) => { setSelectedSlot(idx); setRightView('inspector') }

  const onDropAction = (idx: number, payload: { actionId: string; name: string; value: string; iconOverride?: string }) => {
    updateActivePage(pg => ({
      ...pg,
      slots: { ...pg.slots, [idx]: { actionId: payload.actionId, label: payload.name, value: payload.value || '', iconOverride: payload.iconOverride || '' } },
    }))
    setSelectedSlot(idx); setRightView('inspector')
  }

  const onReorder = (from: number, to: number) => {
    if (from === to) return
    updateActivePage(pg => {
      const slots = { ...pg.slots }
      const a = slots[from]; const b = slots[to]
      if (a) slots[to] = a; else delete slots[to]
      if (b) slots[from] = b; else delete slots[from]
      return { ...pg, slots }
    })
  }

  const onInspectorChange = (next: SlotData) => {
    if (selectedSlot == null) return
    updateActivePage(pg => ({ ...pg, slots: { ...pg.slots, [selectedSlot]: next } }))
  }
  const onInspectorClear = () => {
    if (selectedSlot == null) return
    updateActivePage(pg => {
      const slots = { ...pg.slots }
      delete slots[selectedSlot]
      return { ...pg, slots }
    })
    setRightView('palette')
  }
  const onInspectorDuplicate = () => {
    if (selectedSlot == null) return
    updateActivePage(pg => {
      const total = activeProfile.rows * activeProfile.cols
      let next = -1
      for (let i = 0; i < total; i++) if (!pg.slots[i]) { next = i; break }
      if (next < 0) return pg
      const src = pg.slots[selectedSlot]
      if (!src) return pg
      // Strip context so profileToBackend assigns a fresh one; duplicates must
      // not share context with their source or plugin events apply to both.
      const { context: _drop, ...clone } = src
      return { ...pg, slots: { ...pg.slots, [next]: clone } }
    })
  }

  // ── Profile/Page ops ──────────────────────────────────────────────────────
  const onProfile = async (id: string) => {
    // Activate in backend and load config
    try {
      await invoke('activate_profile_cmd', { name: id })
      const config = await invoke<BackendConfig>('get_config')
      const loaded = backendToProfile(id, config)
      commit(cur => ({
        ...cur,
        profiles: cur.profiles.map(p => p.id === id ? loaded : p),
        activeProfileId: id,
        activePageId: 'p1',
      }))
    } catch {
      commit(cur => ({ ...cur, activeProfileId: id, activePageId: cur.profiles.find(p => p.id === id)?.pages[0].id || 'p1' }))
    }
    setSelectedSlot(null); setRightView('palette')
  }

  const onPage = (id: string) => {
    commit(cur => ({ ...cur, activePageId: id }))
    setSelectedSlot(null); setRightView('palette')
  }

  const onAddProfile = async () => {
    const name = `Profile ${state.profiles.length + 1}`
    try { await invoke('create_profile_cmd', { name }) } catch { /* offline */ }
    commit(cur => {
      const id = name
      return {
        ...cur,
        profiles: [...cur.profiles, { id, name, icon: 'layers', rows: 3, cols: 3, pages: [{ id: 'pg_' + Date.now(), name: 'Home', slots: {} }] }],
        activeProfileId: id,
        activePageId: 'pg_' + Date.now(),
      }
    })
  }

  const onAddPage = () => {
    commit(cur => ({
      ...cur,
      profiles: cur.profiles.map(p =>
        p.id !== cur.activeProfileId ? p : {
          ...p,
          pages: [...p.pages, { id: 'pg_' + Date.now(), name: `Page ${p.pages.length + 1}`, slots: {} }],
        }),
    }))
  }

  const onImportProfile = () => fileInputRef.current?.click()

  const onImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as ProfileData
      if (!parsed.name || !Array.isArray(parsed.pages)) { alert('Invalid profile file'); return }
      const name = parsed.name
      try { await invoke('create_profile_cmd', { name }) } catch { /* offline / already exists */ }
      try { await invoke('activate_profile_cmd', { name }) } catch { /* offline */ }
      commit(cur => ({
        ...cur,
        profiles: [...cur.profiles.filter(p => p.id !== name), { ...parsed, id: name, name }],
        activeProfileId: name,
        activePageId: parsed.pages[0]?.id || 'p1',
      }))
      setSelectedSlot(null); setRightView('palette')
    } catch (err) {
      alert('Failed to import profile: ' + err)
    }
  }

  const onReset = async () => {
    if (!confirm('Reset active profile to defaults?')) return
    try { await invoke('save_config', { config: { grid: { rows: 3, cols: 3 }, buttons: [] } }) } catch { /* offline */ }
    commit(cur => ({
      ...cur,
      profiles: cur.profiles.map(p =>
        p.id !== cur.activeProfileId ? p : makeInitialProfiles()[0]
      ),
      activePageId: 'p1',
    }))
    setSelectedSlot(null)
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable

      // Escape always dismisses — cancel/close expected to work even while typing.
      if (e.key === 'Escape') {
        setCmdOpen(false); setConnectOpen(false); setShortcutsOpen(false)
        setSelectedSlot(null); setRightView('palette')
        return
      }

      // All other shortcuts are suppressed when a text field has focus so that
      // typing characters or using browser-native Cmd+Z for text editing works.
      if (inInput) return

      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'k') { e.preventDefault(); setCmdOpen(v => !v) }
      else if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (meta && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      else if (e.key === '?') { setShortcutsOpen(v => !v) }
      else if (selectedSlot != null && e.key === 'Delete') onInspectorClear()
      else if (/^[1-9]$/.test(e.key)) {
        const i = parseInt(e.key, 10) - 1
        const total = activeProfile.rows * activeProfile.cols
        if (i < total) onSlotClick(i)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hIdx, selectedSlot, activeProfile])

  // ── Command palette actions ───────────────────────────────────────────────
  const onCmd = (it: { kind: string; id: string }) => {
    if (it.kind === 'cmd') {
      if (it.id === 'undo')      undo()
      else if (it.id === 'redo') redo()
      else if (it.id === 'connect')   setConnectOpen(true)
      else if (it.id === 'shortcuts') setShortcutsOpen(true)
    } else if (it.kind === 'action') {
      const total = activeProfile.rows * activeProfile.cols
      let next = -1
      for (let i = 0; i < total; i++) if (!activePage.slots[i]) { next = i; break }
      if (next < 0) return
      const a = findAction(it.id)
      if (a) onDropAction(next, { actionId: it.id, name: a.name, value: a.hint || '' })
    }
  }

  if (loading) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0c', color: 'rgba(255,255,255,0.3)', fontFamily: '-apple-system,sans-serif', fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      background: theme.bg, fontFamily: theme.font, color: theme.text,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Decorative blobs */}
      <div style={{
        position: 'absolute', top: -120, right: -100, width: 420, height: 420,
        borderRadius: '50%', filter: 'blur(80px)',
        background: `radial-gradient(circle, color-mix(in oklch, ${theme.accent} 35%, transparent), transparent 70%)`,
        opacity: 0.6, pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -100, left: -80, width: 360, height: 360,
        borderRadius: '50%', filter: 'blur(80px)',
        background: `radial-gradient(circle, oklch(0.72 0.15 ${tweaks.hue + 60}), transparent 70%)`,
        opacity: tweaks.dark ? 0.25 : 0.4, pointerEvents: 'none',
      }} />

      {/* Toolbar */}
      <div style={{
        flexShrink: 0,
        borderBottom: `0.5px solid ${theme.border}`,
        background: tweaks.dark ? 'rgba(20,20,24,0.5)' : 'rgba(255,255,255,0.4)',
        backdropFilter: theme.blur,
        WebkitBackdropFilter: theme.blur,
        position: 'relative', zIndex: 5,
      }}>
        <Toolbar
          theme={theme}
          onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo}
          onConnect={() => setConnectOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
          onCommand={() => setCmdOpen(true)}
          onReset={onReset}
          profileName={activeProfile.name}
          dirty={dirty}
          dark={tweaks.dark}
          onToggleDark={() => setTweak('dark', !tweaks.dark)}
          serverPort={serverPort}
          appVersion={appVersion}
          launchAtLogin={launchAtLogin}
          onToggleLaunchAtLogin={async () => {
            const next = !launchAtLogin
            setLaunchAtLogin(next)
            try { await invoke('set_autostart', { enabled: next }) } catch { setLaunchAtLogin(!next) }
          }}
          onQuit={() => invoke('quit_app').catch(() => {})}
        />
      </div>

      {/* Body — three zones */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14, padding: 14, position: 'relative', zIndex: 1 }}>
        {/* Left: profiles */}
        <ProfilesRail
          profiles={state.profiles}
          activeProfileId={state.activeProfileId}
          activePageId={state.activePageId}
          onProfile={onProfile} onPage={onPage}
          onAddProfile={onAddProfile} onAddPage={onAddPage}
          theme={theme}
        />

        {/* Center: device canvas */}
        <Glass theme={theme} radius={theme.radiusLg} style={{
          flex: 1, padding: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Grid size controls */}
          <div style={{
            position: 'absolute', top: 16, right: 16,
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 11, color: theme.textMute,
          }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: theme.textFaint }}>Grid</span>
            <Stepper theme={theme} label="Rows" value={activeProfile.rows} min={1} max={5}
              onChange={v => commit(cur => ({ ...cur, profiles: cur.profiles.map(p => p.id === cur.activeProfileId ? { ...p, rows: v } : p) }))} />
            <Stepper theme={theme} label="Cols" value={activeProfile.cols} min={1} max={6}
              onChange={v => commit(cur => ({ ...cur, profiles: cur.profiles.map(p => p.id === cur.activeProfileId ? { ...p, cols: v } : p) }))} />
          </div>

          {/* Page tabs */}
          <div style={{
            position: 'absolute', top: 16, left: 16,
            display: 'inline-flex', gap: 0, padding: 3,
            background: tweaks.dark ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.04)',
            border: `0.5px solid ${theme.border}`,
            borderRadius: 9,
          }}>
            {activeProfile.pages.map((pg, i) => {
              const isActive = pg.id === state.activePageId
              return (
                <button key={pg.id} onClick={() => onPage(pg.id)} style={{
                  all: 'unset', cursor: 'pointer',
                  padding: '4px 11px', borderRadius: 6,
                  fontSize: 11, fontWeight: 600, letterSpacing: '-0.005em',
                  background: isActive
                    ? (tweaks.dark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.85)')
                    : 'transparent',
                  color: isActive ? theme.text : theme.textMute,
                  boxShadow: isActive
                    ? `0 0.5px 0 ${theme.inset} inset, 0 1px 2px rgba(0,0,0,0.1)`
                    : 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: isActive ? theme.accent : theme.textFaint, fontSize: 10 }}>{i + 1}</span>
                  {pg.name}
                </button>
              )
            })}
          </div>

          <DeviceCanvas
            profile={activeProfile}
            page={activePage}
            selectedSlot={selectedSlot}
            theme={theme}
            onSlotClick={onSlotClick}
            onDropAction={(idx, payload) => onDropAction(idx, { actionId: payload.actionId, name: payload.name, value: payload.value || '', iconOverride: payload.iconOverride })}
            onReorder={onReorder}
          />
        </Glass>

        {/* Right: palette or inspector */}
        <Glass theme={theme} radius={theme.radiusLg} style={{ width: 280, padding: 14, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {rightView === 'inspector' && selectedSlot != null ? (
            <Inspector
              slot={activePage.slots[selectedSlot]}
              slotIdx={selectedSlot}
              theme={theme}
              onChange={onInspectorChange}
              onClear={onInspectorClear}
              onClose={() => { setRightView('palette'); setSelectedSlot(null) }}
              onDuplicate={onInspectorDuplicate}
            />
          ) : (
            <>
              <AutocompleteSettings theme={theme} />
              <ActionPalette theme={theme}
                onTemplate={(t) => {
                  const total = activeProfile.rows * activeProfile.cols
                  let next = -1
                  for (let i = 0; i < total; i++) if (!activePage.slots[i]) { next = i; break }
                  if (next < 0) return
                  onDropAction(next, { actionId: t.actionId, name: t.name, value: t.value, iconOverride: t.icon })
                }}
              />
            </>
          )}
        </Glass>
      </div>

      {/* Overlays */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} theme={theme} onAction={onCmd} />
      <ConnectPopover open={connectOpen} onClose={() => setConnectOpen(false)} theme={theme} url={lanUrl} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} theme={theme} />
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={onImportFileChange} />
    </div>
  )
}
