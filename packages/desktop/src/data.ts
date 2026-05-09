export interface SlotData {
  actionId: string
  label: string
  value: string
  iconOverride?: string
  context?: string
}

export interface PageData {
  id: string
  name: string
  slots: Record<number, SlotData>
}

export interface ProfileData {
  id: string
  name: string
  icon: string
  rows: number
  cols: number
  pages: PageData[]
}

export interface ActionDef {
  id: string
  name: string
  icon: string
  hint?: string
}

export interface ActionCategory {
  category: string
  color: string
  actions: ActionDef[]
}

export interface ActionDefFull extends ActionDef {
  category: string
  color: string
}

export interface QuickTemplate {
  id: string
  name: string
  actionId: string
  value: string
  icon: string
}

export const ACTION_LIBRARY: ActionCategory[] = [
  {
    category: 'Browser',
    color: 'oklch(0.72 0.18 230)',
    actions: [
      { id: 'open-url',  name: 'Open URL',  icon: 'globe',    hint: 'https://…' },
      { id: 'open-tab',  name: 'New Tab',   icon: 'tab',      hint: 'Browser tab' },
      { id: 'bookmark',  name: 'Bookmark',  icon: 'bookmark', hint: 'Saved page' },
    ],
  },
  {
    category: 'System',
    color: 'oklch(0.72 0.16 145)',
    actions: [
      { id: 'open-app',    name: 'Open App',        icon: 'app',     hint: 'Launch application' },
      { id: 'vol-up',      name: 'Volume Up',        icon: 'volup',   hint: 'System volume +' },
      { id: 'vol-down',    name: 'Volume Down',      icon: 'voldown', hint: 'System volume −' },
      { id: 'mute',        name: 'Mute Toggle',      icon: 'mute',    hint: 'Toggle mute' },
      { id: 'bright-up',   name: 'Brightness Up',    icon: 'sun',     hint: 'Display +' },
      { id: 'bright-down', name: 'Brightness Down',  icon: 'moon',    hint: 'Display −' },
      { id: 'sleep',       name: 'Sleep',            icon: 'sleep',   hint: 'Sleep machine' },
      { id: 'lock',        name: 'Lock Screen',      icon: 'lock',    hint: 'Lock session' },
    ],
  },
  {
    category: 'Media',
    color: 'oklch(0.72 0.18 30)',
    actions: [
      { id: 'play', name: 'Play / Pause', icon: 'play', hint: 'Media key' },
      { id: 'next', name: 'Next Track',   icon: 'next', hint: 'Media key' },
      { id: 'prev', name: 'Prev Track',   icon: 'prev', hint: 'Media key' },
    ],
  },
  {
    category: 'Shortcut',
    color: 'oklch(0.72 0.17 290)',
    actions: [
      { id: 'hotkey',    name: 'Run Hotkey',     icon: 'cmd',      hint: '⌘⇧+key' },
      { id: 'shell',     name: 'Shell Command',  icon: 'terminal', hint: '$ run' },
      { id: 'shortcut',  name: 'Apple Shortcut', icon: 'spark',    hint: 'Run by name' },
    ],
  },
  {
    category: 'Folder',
    color: 'oklch(0.74 0.13 75)',
    actions: [
      { id: 'group', name: 'Folder', icon: 'folder', hint: 'Nest actions' },
    ],
  },
]

export function findAction(id: string): ActionDefFull | null {
  for (const cat of ACTION_LIBRARY) {
    const a = cat.actions.find(x => x.id === id)
    if (a) return { ...a, category: cat.category, color: cat.color }
  }
  return null
}

export function makeInitialProfiles(): ProfileData[] {
  return [
    {
      id: 'Default',
      name: 'Default',
      icon: 'home',
      rows: 3, cols: 3,
      pages: [
        {
          id: 'p1', name: 'Home',
          slots: {
            0: { actionId: 'open-url',  label: 'GitHub',     value: 'https://github.com',  iconOverride: 'github' },
            1: { actionId: 'open-url',  label: 'Google',     value: 'https://google.com',  iconOverride: 'google' },
            2: { actionId: 'open-app',  label: 'Calculator', value: 'Calculator',          iconOverride: 'calc' },
            4: { actionId: 'play',      label: 'Play',       value: '' },
            5: { actionId: 'mute',      label: 'Mute',       value: '' },
            7: { actionId: 'bright-up', label: 'Bright +',   value: '' },
            8: { actionId: 'lock',      label: 'Lock',       value: '' },
          },
        },
      ],
    },
  ]
}

export const QUICK_TEMPLATES: QuickTemplate[] = [
  { id: 't-github',  name: 'GitHub',   actionId: 'open-url', value: 'https://github.com', icon: 'github' },
  { id: 't-google',  name: 'Google',   actionId: 'open-url', value: 'https://google.com', icon: 'google' },
  { id: 't-mail',    name: 'Mail',     actionId: 'open-app', value: 'Mail',               icon: 'mail' },
  { id: 't-cal',     name: 'Calendar', actionId: 'open-app', value: 'Calendar',           icon: 'calendar' },
  { id: 't-claude',  name: 'Claude',   actionId: 'open-url', value: 'https://claude.ai',  icon: 'spark' },
  { id: 't-zoom',    name: 'Zoom',     actionId: 'open-app', value: 'zoom.us',            icon: 'video' },
]
