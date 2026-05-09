import { describe, it, expect } from 'vitest'
import {
  ACTION_TO_UUID,
  UUID_TO_ACTION,
  slotToSettings,
  settingsToValue,
  genContext,
  backendToProfile,
  profileToBackend,
} from '../bridge'
import { ACTION_LIBRARY } from '../data'
import type { BackendConfig } from '../bridge'
import type { ProfileData } from '../data'

// ── Mapping completeness ──────────────────────────────────────────────────────

describe('ACTION_TO_UUID', () => {
  it('covers every actionId in ACTION_LIBRARY', () => {
    const allIds = ACTION_LIBRARY.flatMap(cat => cat.actions.map(a => a.id))
    const missing = allIds.filter(id => !(id in ACTION_TO_UUID))
    expect(missing, `no UUID mapping for: ${missing.join(', ')}`).toHaveLength(0)
  })

  it('every UUID is unique (no collisions)', () => {
    const uuids = Object.values(ACTION_TO_UUID)
    expect(new Set(uuids).size).toBe(uuids.length)
  })

  it('every UUID follows com.pannacotta.* pattern', () => {
    for (const uuid of Object.values(ACTION_TO_UUID)) {
      expect(uuid).toMatch(/^com\.pannacotta\..+/)
    }
  })
})

describe('UUID_TO_ACTION', () => {
  it('is exact inverse of ACTION_TO_UUID', () => {
    for (const [actionId, uuid] of Object.entries(ACTION_TO_UUID)) {
      expect(UUID_TO_ACTION[uuid]).toBe(actionId)
    }
  })

  it('has same size as ACTION_TO_UUID', () => {
    expect(Object.keys(UUID_TO_ACTION).length).toBe(Object.keys(ACTION_TO_UUID).length)
  })
})

// ── Settings round-trip ───────────────────────────────────────────────────────

describe('slotToSettings / settingsToValue round-trip', () => {
  const cases: Array<[string, string]> = [
    ['open-url', 'https://github.com'],
    ['open-url', 'http://localhost:3000'],
    ['open-app', 'Calculator'],
    ['open-app', 'Spotify'],
    ['shell', 'echo hello && ls -la'],
    ['hotkey', '⌘⇧P'],
    ['shortcut', 'Focus Work'],
  ]

  it.each(cases)('%s → settings → value round-trips correctly', (actionId, value) => {
    const settings = slotToSettings(actionId, value)
    const recovered = settingsToValue(actionId, settings)
    expect(recovered).toBe(value)
  })

  it('no-value actions produce empty settings', () => {
    for (const id of ['vol-up', 'vol-down', 'mute', 'bright-up', 'bright-down', 'sleep', 'lock', 'play', 'next', 'prev']) {
      expect(slotToSettings(id, '')).toEqual({})
    }
  })

  it('no-value actions return empty string from settingsToValue', () => {
    for (const id of ['vol-up', 'mute', 'sleep', 'lock']) {
      expect(settingsToValue(id, {})).toBe('')
    }
  })

  it('empty value produces empty settings', () => {
    expect(slotToSettings('open-url', '')).toEqual({ url: '' })
    expect(slotToSettings('open-app', '')).toEqual({ appName: '' })
  })
})

// ── genContext ────────────────────────────────────────────────────────────────

describe('genContext', () => {
  it('produces 12-character string', () => {
    expect(genContext()).toHaveLength(12)
  })

  it('only alphanumeric characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(genContext()).toMatch(/^[A-Za-z0-9]{12}$/)
    }
  })

  it('generates unique values', () => {
    const contexts = new Set(Array.from({ length: 200 }, genContext))
    expect(contexts.size).toBeGreaterThan(190) // collision probability astronomically low
  })
})

// ── backendToProfile ──────────────────────────────────────────────────────────

describe('backendToProfile', () => {
  const makeBackend = (buttons: BackendConfig['buttons']): BackendConfig => ({
    grid: { rows: 2, cols: 3 },
    buttons,
  })

  it('maps actionUUID to actionId correctly', () => {
    const cfg = makeBackend([{
      name: 'GitHub', icon: 'github',
      actionUUID: 'com.pannacotta.browser.open-url',
      context: 'ctx001',
      settings: { url: 'https://github.com' },
    }])
    const profile = backendToProfile('Test', cfg)
    expect(profile.pages[0].slots[0]).toMatchObject({
      actionId: 'open-url',
      label: 'GitHub',
      value: 'https://github.com',
      context: 'ctx001',
    })
  })

  it('maps open-app correctly', () => {
    const cfg = makeBackend([{
      name: 'Calc', icon: 'calc',
      actionUUID: 'com.pannacotta.system.open-app',
      context: 'ctx002',
      settings: { appName: 'Calculator' },
    }])
    const { slots } = backendToProfile('T', cfg).pages[0]
    expect(slots[0]).toMatchObject({ actionId: 'open-app', value: 'Calculator' })
  })

  it('maps shell to run-command UUID correctly', () => {
    const cfg = makeBackend([{
      name: 'Build', icon: 'terminal',
      actionUUID: 'com.pannacotta.system.run-command',
      context: 'ctx003',
      settings: { command: 'npm run build' },
    }])
    const { slots } = backendToProfile('T', cfg).pages[0]
    expect(slots[0]).toMatchObject({ actionId: 'shell', value: 'npm run build' })
  })

  it('skips empty (com.pannacotta.empty) slots', () => {
    const cfg = makeBackend([
      { name: '', icon: '', actionUUID: 'com.pannacotta.empty', context: 'empty-0', settings: {} },
      { name: 'Play', icon: 'play', actionUUID: 'com.pannacotta.media.play', context: 'ctx1', settings: {} },
    ])
    const { slots } = backendToProfile('T', cfg).pages[0]
    expect(slots[0]).toBeUndefined()
    expect(slots[1]).toMatchObject({ actionId: 'play' })
  })

  it('skips blank actionUUID slots', () => {
    const cfg = makeBackend([
      { name: '', icon: '', actionUUID: '', context: 'x', settings: {} },
    ])
    const { slots } = backendToProfile('T', cfg).pages[0]
    expect(Object.keys(slots)).toHaveLength(0)
  })

  it('preserves context on each slot', () => {
    const cfg = makeBackend([{
      name: 'Lock', icon: 'lock',
      actionUUID: 'com.pannacotta.system.lock',
      context: 'myctx123',
      settings: {},
    }])
    const { slots } = backendToProfile('T', cfg).pages[0]
    expect(slots[0].context).toBe('myctx123')
  })

  it('falls back gracefully on unknown UUID', () => {
    const cfg = makeBackend([{
      name: 'Mystery', icon: '',
      actionUUID: 'com.pannacotta.unknown.custom-thing',
      context: 'ctx9',
      settings: {},
    }])
    const { slots } = backendToProfile('T', cfg).pages[0]
    expect(slots[0].actionId).toBe('custom-thing')
  })

  it('sets profile metadata correctly', () => {
    const cfg = makeBackend([])
    const profile = backendToProfile('My Profile', cfg)
    expect(profile.id).toBe('My Profile')
    expect(profile.name).toBe('My Profile')
    expect(profile.rows).toBe(2)
    expect(profile.cols).toBe(3)
  })

  it('does not exceed grid bounds', () => {
    // 11 buttons for a 2×3=6 grid — only first 6 should be indexed
    const buttons = Array.from({ length: 11 }, (_, i) => ({
      name: `Btn${i}`, icon: '',
      actionUUID: 'com.pannacotta.system.lock',
      context: `ctx${i}`,
      settings: {},
    }))
    const cfg = makeBackend(buttons)
    const { slots } = backendToProfile('T', cfg).pages[0]
    const maxIdx = Math.max(...Object.keys(slots).map(Number))
    expect(maxIdx).toBeLessThan(6)
  })
})

// ── profileToBackend ──────────────────────────────────────────────────────────

describe('profileToBackend', () => {
  const makeProfile = (slots: ProfileData['pages'][0]['slots']): ProfileData => ({
    id: 'Test', name: 'Test', icon: 'home',
    rows: 2, cols: 3,
    pages: [{ id: 'p1', name: 'Home', slots }],
  })

  it('maps actionId to actionUUID correctly', () => {
    const profile = makeProfile({ 0: { actionId: 'open-url', label: 'GitHub', value: 'https://github.com' } })
    const cfg = profileToBackend(profile)
    expect(cfg.buttons[0].actionUUID).toBe('com.pannacotta.browser.open-url')
    expect(cfg.buttons[0].settings).toEqual({ url: 'https://github.com' })
    expect(cfg.buttons[0].name).toBe('GitHub')
  })

  it('maps shell to run-command UUID', () => {
    const profile = makeProfile({ 0: { actionId: 'shell', label: 'Build', value: 'npm run build' } })
    const cfg = profileToBackend(profile)
    expect(cfg.buttons[0].actionUUID).toBe('com.pannacotta.system.run-command')
    expect(cfg.buttons[0].settings).toEqual({ command: 'npm run build' })
  })

  it('empty slots use com.pannacotta.empty UUID', () => {
    const profile = makeProfile({})
    const cfg = profileToBackend(profile)
    expect(cfg.buttons).toHaveLength(6) // 2×3
    for (const btn of cfg.buttons) {
      expect(btn.actionUUID).toBe('com.pannacotta.empty')
    }
  })

  it('preserves existing context', () => {
    const profile = makeProfile({
      0: { actionId: 'lock', label: 'Lock', value: '', context: 'stable-ctx' },
    })
    const cfg = profileToBackend(profile)
    expect(cfg.buttons[0].context).toBe('stable-ctx')
  })

  it('generates context when slot has none', () => {
    const profile = makeProfile({
      0: { actionId: 'lock', label: 'Lock', value: '' },
    })
    const cfg = profileToBackend(profile)
    expect(cfg.buttons[0].context).toMatch(/^[A-Za-z0-9]{12}$/)
  })

  it('grid dimensions match profile', () => {
    const profile: ProfileData = {
      id: 'T', name: 'T', icon: 'home', rows: 3, cols: 4,
      pages: [{ id: 'p1', name: 'Home', slots: {} }],
    }
    const cfg = profileToBackend(profile)
    expect(cfg.grid).toEqual({ rows: 3, cols: 4 })
    expect(cfg.buttons).toHaveLength(12) // 3×4
  })

  it('button count always equals rows × cols', () => {
    const profile = makeProfile({
      0: { actionId: 'vol-up', label: 'Vol+', value: '' },
      2: { actionId: 'mute', label: 'Mute', value: '' },
      5: { actionId: 'lock', label: 'Lock', value: '' },
    })
    const cfg = profileToBackend(profile)
    expect(cfg.buttons).toHaveLength(6) // 2×3
  })

  it('unknown actionId produces com.pannacotta.unknown.* UUID', () => {
    const profile = makeProfile({
      0: { actionId: 'custom-future-action', label: 'Custom', value: 'something' },
    })
    const cfg = profileToBackend(profile)
    expect(cfg.buttons[0].actionUUID).toBe('com.pannacotta.unknown.custom-future-action')
  })

  it('uses specified pageId when provided', () => {
    const profile: ProfileData = {
      id: 'T', name: 'T', icon: 'home', rows: 1, cols: 1,
      pages: [
        { id: 'p1', name: 'Home', slots: { 0: { actionId: 'lock', label: 'Lock', value: '' } } },
        { id: 'p2', name: 'Media', slots: { 0: { actionId: 'play', label: 'Play', value: '' } } },
      ],
    }
    const cfg = profileToBackend(profile, 'p2')
    expect(cfg.buttons[0].actionUUID).toBe('com.pannacotta.media.play')
  })
})

// ── Full round-trip ───────────────────────────────────────────────────────────

describe('round-trip: profileToBackend → backendToProfile', () => {
  it('preserves all slots with stable contexts', () => {
    const original: ProfileData = {
      id: 'Test', name: 'Test', icon: 'home', rows: 2, cols: 3,
      pages: [{
        id: 'p1', name: 'Home',
        slots: {
          0: { actionId: 'open-url', label: 'GitHub', value: 'https://github.com', iconOverride: 'github', context: 'ctx_gh' },
          1: { actionId: 'open-app', label: 'Calc', value: 'Calculator', context: 'ctx_calc' },
          2: { actionId: 'play', label: 'Play', value: '', context: 'ctx_play' },
          4: { actionId: 'mute', label: 'Mute', value: '', context: 'ctx_mute' },
          5: { actionId: 'lock', label: 'Lock', value: '', context: 'ctx_lock' },
        },
      }],
    }

    const backend = profileToBackend(original)
    const recovered = backendToProfile('Test', backend)
    const slots = recovered.pages[0].slots

    expect(slots[0]).toMatchObject({ actionId: 'open-url', label: 'GitHub', value: 'https://github.com', context: 'ctx_gh' })
    expect(slots[1]).toMatchObject({ actionId: 'open-app', label: 'Calc', value: 'Calculator', context: 'ctx_calc' })
    expect(slots[2]).toMatchObject({ actionId: 'play', label: 'Play', value: '', context: 'ctx_play' })
    expect(slots[3]).toBeUndefined() // empty slot
    expect(slots[4]).toMatchObject({ actionId: 'mute', label: 'Mute', context: 'ctx_mute' })
    expect(slots[5]).toMatchObject({ actionId: 'lock', label: 'Lock', context: 'ctx_lock' })
  })

  it('preserves shell command value', () => {
    const original: ProfileData = {
      id: 'T', name: 'T', icon: 'home', rows: 1, cols: 1,
      pages: [{ id: 'p1', name: 'Home', slots: {
        0: { actionId: 'shell', label: 'Build', value: 'npm run build && echo done', context: 'ctx1' },
      }}],
    }
    const recovered = backendToProfile('T', profileToBackend(original))
    expect(recovered.pages[0].slots[0].value).toBe('npm run build && echo done')
  })

  it('all actionIds in ACTION_LIBRARY survive round-trip', () => {
    const allActions = ACTION_LIBRARY.flatMap(cat => cat.actions)
    const slots: ProfileData['pages'][0]['slots'] = {}
    allActions.forEach((a, i) => {
      slots[i] = { actionId: a.id, label: a.name, value: 'test-value', context: `ctx-${i}` }
    })
    const profile: ProfileData = {
      id: 'All', name: 'All', icon: 'home',
      rows: Math.ceil(allActions.length / 3), cols: 3,
      pages: [{ id: 'p1', name: 'Home', slots }],
    }
    const recovered = backendToProfile('All', profileToBackend(profile))
    allActions.forEach((a, i) => {
      expect(recovered.pages[0].slots[i]?.actionId, `actionId for ${a.id}`).toBe(a.id)
      expect(recovered.pages[0].slots[i]?.context, `context for ${a.id}`).toBe(`ctx-${i}`)
    })
  })
})

// ── Regression: old format never accepted ────────────────────────────────────

describe('regression: old BackendButton format', () => {
  it('does NOT load slots from old format (type/action fields) — they have no actionUUID', () => {
    // Simulate what would happen if someone passed the old format
    const oldFormatBackend = {
      grid: { rows: 1, cols: 1 },
      buttons: [{ name: 'GitHub', icon: 'github', type: 'open-url', action: 'https://github.com' }],
    } as unknown as BackendConfig

    // backendToProfile checks btn.actionUUID — old format has none, slot should be empty
    const profile = backendToProfile('T', oldFormatBackend)
    expect(profile.pages[0].slots[0]).toBeUndefined()
  })
})
