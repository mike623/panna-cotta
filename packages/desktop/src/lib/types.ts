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
