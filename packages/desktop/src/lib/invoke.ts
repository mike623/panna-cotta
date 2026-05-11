import { invoke } from '@tauri-apps/api/core'
import type { PluginInfo } from './types'

export const listPlugins = () =>
  invoke<PluginInfo[]>('list_plugins_cmd')

export const listInstalledApps = () =>
  invoke<string[] | null>('list_installed_apps')
