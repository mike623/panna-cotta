import { invoke } from '@tauri-apps/api/core'
import type { PluginInfo } from './types'

export const listPlugins = () =>
  invoke<PluginInfo[]>('list_plugins_cmd')

export const listInstalledApps = () =>
  invoke<string[] | null>('list_installed_apps')

export interface AutocompleteConfig {
  enabled: boolean
  suggestion_count: number
  fallback_phrases: string[]
}

export const getAutocompleteConfig = () =>
  invoke<AutocompleteConfig>('get_autocomplete_config')

export const setAutocompleteEnabled = (enabled: boolean) =>
  invoke<void>('set_autocomplete_enabled', { enabled })

export const setAutocompleteSuggestionCount = (count: number) =>
  invoke<void>('set_autocomplete_suggestion_count', { count })

export const setAutocompleteFallbackPhrases = (phrases: string[]) =>
  invoke<void>('set_autocomplete_fallback_phrases', { phrases })

export const getAccessibilityStatus = () =>
  invoke<boolean>('get_accessibility_status')
