export interface Button {
  name: string
  type: 'browser' | 'system'
  icon: string
  action: string
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

export interface VersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
  releaseUrl: string | null
}

export interface ServerInfo {
  ip: string
  port: number
}
