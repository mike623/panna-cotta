import { findAction } from './data'
import type { ProfileData, SlotData } from './data'

export interface BackendButton {
  name: string
  icon: string
  actionUUID: string
  context: string
  settings: Record<string, unknown>
  lanAllowed?: boolean | null
}
export interface BackendConfig {
  grid: { rows: number; cols: number }
  buttons: BackendButton[]
}

export const ACTION_TO_UUID: Record<string, string> = {
  'open-url':    'com.pannacotta.browser.open-url',
  'open-tab':    'com.pannacotta.browser.open-tab',
  'bookmark':    'com.pannacotta.browser.bookmark',
  'open-app':    'com.pannacotta.system.open-app',
  'vol-up':      'com.pannacotta.system.volume-up',
  'vol-down':    'com.pannacotta.system.volume-down',
  'mute':        'com.pannacotta.system.volume-mute',
  'bright-up':   'com.pannacotta.system.brightness-up',
  'bright-down': 'com.pannacotta.system.brightness-down',
  'sleep':       'com.pannacotta.system.sleep',
  'lock':        'com.pannacotta.system.lock',
  'play':        'com.pannacotta.media.play',
  'next':        'com.pannacotta.media.next',
  'prev':        'com.pannacotta.media.prev',
  'hotkey':      'com.pannacotta.shortcut.hotkey',
  'shell':       'com.pannacotta.system.run-command',
  'shortcut':    'com.pannacotta.shortcut.shortcut',
  'group':       'com.pannacotta.folder.group',
}

export const UUID_TO_ACTION: Record<string, string> = Object.fromEntries(
  Object.entries(ACTION_TO_UUID).map(([k, v]) => [v, k])
)

export function slotToSettings(actionId: string, value: string): Record<string, unknown> {
  switch (actionId) {
    case 'open-url': return { url: value }
    case 'open-app': return { appName: value }
    case 'shell':    return { command: value }
    case 'hotkey':   return { key: value }
    case 'shortcut': return { name: value }
    default:         return value ? { value } : {}
  }
}

export function settingsToValue(actionId: string, settings: Record<string, unknown>): string {
  const s = (k: string) => (typeof settings[k] === 'string' ? settings[k] as string : '')
  switch (actionId) {
    case 'open-url': return s('url')
    case 'open-app': return s('appName')
    case 'shell':    return s('command')
    case 'hotkey':   return s('key')
    case 'shortcut': return s('name')
    default:         return s('value')
  }
}

export function genContext(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * 62)]).join('')
}

export function backendToProfile(name: string, config: BackendConfig): ProfileData {
  const total = config.grid.rows * config.grid.cols
  const slots: Record<number, SlotData> = {}
  config.buttons.forEach((btn, idx) => {
    if (idx < total && btn.actionUUID && btn.actionUUID !== '' && !btn.actionUUID.startsWith('com.pannacotta.empty')) {
      const actionId = UUID_TO_ACTION[btn.actionUUID] || btn.actionUUID.split('.').pop() || 'open-url'
      slots[idx] = {
        actionId,
        label: btn.name,
        value: settingsToValue(actionId, btn.settings || {}),
        iconOverride: btn.icon || undefined,
        context: btn.context,
      }
    }
  })
  return {
    id: name, name,
    icon: 'home',
    rows: config.grid.rows,
    cols: config.grid.cols,
    pages: [{ id: 'p1', name: 'Home', slots }],
  }
}

export function profileToBackend(profile: ProfileData, pageId?: string): BackendConfig {
  const page = (pageId ? profile.pages.find(p => p.id === pageId) : null) || profile.pages[0]
  const total = profile.rows * profile.cols
  const buttons: BackendButton[] = []
  const seen = new Set<string>()
  for (let i = 0; i < total; i++) {
    const slot = page?.slots[i]
    if (slot) {
      let context = slot.context || genContext()
      // Defensive dedup: if two slots somehow share a context, regenerate.
      // Plugin events route by context; collisions cause cross-slot updates.
      while (seen.has(context)) context = genContext()
      seen.add(context)
      buttons.push({
        name: slot.label,
        icon: slot.iconOverride || findAction(slot.actionId)?.icon || '',
        actionUUID: ACTION_TO_UUID[slot.actionId] || `com.pannacotta.unknown.${slot.actionId}`,
        context,
        settings: slotToSettings(slot.actionId, slot.value),
      })
    } else {
      buttons.push({ name: '', icon: '', actionUUID: 'com.pannacotta.empty', context: `empty-${i}`, settings: {} })
    }
  }
  return { grid: { rows: profile.rows, cols: profile.cols }, buttons }
}
