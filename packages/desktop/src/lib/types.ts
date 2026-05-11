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
