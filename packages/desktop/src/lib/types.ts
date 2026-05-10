export interface Button {
  name: string
  icon: string
  actionUUID: string
  context: string
  settings: Record<string, unknown>
  lanAllowed?: boolean | null
}

export interface Grid {
  rows: number
  cols: number
}

export interface StreamDeckConfig {
  grid: Grid
  buttons: Button[]
}

export interface Profile {
  name: string
  isActive: boolean
}

export interface ServerInfo {
  ip: string
  port: number
}

export interface ActionInfo {
  uuid: string
  name: string
  piPath: string | null
}

export interface PluginInfo {
  uuid: string
  name: string
  version: string
  author: string
  description: string
  status: 'running' | 'starting' | 'stopped' | 'errored' | 'not_spawned'
  actions: ActionInfo[]
}

export interface PluginRenderState {
  images: Record<string, string>
  titles: Record<string, string>
  states: Record<string, number>
}
