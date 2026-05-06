import { invoke } from '@tauri-apps/api/core'
import type { StreamDeckConfig, Profile, ServerInfo } from './types'

export const getConfig = () =>
  invoke<StreamDeckConfig>('get_config')

export const saveConfig = (config: StreamDeckConfig) =>
  invoke<void>('save_config', { config })

export const getDefaultConfig = () =>
  invoke<StreamDeckConfig>('get_default_config')

export const listProfiles = () =>
  invoke<Profile[]>('list_profiles_cmd')

export const createProfile = (name: string) =>
  invoke<void>('create_profile_cmd', { name })

export const activateProfile = (name: string) =>
  invoke<void>('activate_profile_cmd', { name })

export const renameProfile = (oldName: string, newName: string) =>
  invoke<void>('rename_profile_cmd', { oldName, newName })

export const deleteProfile = (name: string) =>
  invoke<void>('delete_profile_cmd', { name })

export const openConfigFolder = () =>
  invoke<void>('open_config_folder')

export const executeCommand = (action: string, target: string) =>
  invoke<void>('execute_command', { action, target })

export const openApp = (appName: string) =>
  invoke<void>('open_app', { appName })

export const openUrl = (url: string) =>
  invoke<void>('open_url', { url })

export const getServerInfo = () =>
  invoke<ServerInfo>('get_server_info')

export const getCsrfToken = () =>
  invoke<string>('get_csrf_token')
