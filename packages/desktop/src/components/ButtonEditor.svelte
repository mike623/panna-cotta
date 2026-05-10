<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { saveConfig } from '../lib/invoke'
  import type { Button, StreamDeckConfig, ServerInfo, PluginInfo } from '../lib/types'

  export let config: StreamDeckConfig
  export let selectedIndex: number = -1
  export let serverInfo: ServerInfo | null = null
  export let plugins: PluginInfo[] = []

  const dispatch = createEventDispatcher<{
    save: void
    toast: { message: string; ok: boolean }
  }>()

  const MEDIA_ACTIONS = ['volume-up', 'volume-down', 'volume-mute', 'brightness-up', 'brightness-down', 'sleep', 'lock']

  let name = ''
  let formType: 'browser' | 'system' = 'browser'
  let icon = ''
  let action = ''
  let jsonSettings = '{}'

  function isBuiltInUUID(uuid: string): boolean {
    return uuid.startsWith('com.pannacotta.')
  }

  function findPluginAction(uuid: string) {
    for (const plugin of plugins) {
      const act = plugin.actions.find(a => a.uuid === uuid)
      if (act) return { plugin, action: act }
    }
    return null
  }

  function buttonToForm(btn: Button): { formType: 'browser' | 'system'; action: string } {
    const uuid = btn.actionUUID
    if (uuid === 'com.pannacotta.browser.open-url') {
      return { formType: 'browser', action: String((btn.settings as Record<string, unknown>)?.url ?? '') }
    }
    if (uuid.startsWith('com.pannacotta.system.')) {
      const actionName = uuid.replace('com.pannacotta.system.', '')
      if (actionName === 'open-app') {
        return { formType: 'system', action: String((btn.settings as Record<string, unknown>)?.appName ?? '') }
      }
      return { formType: 'system', action: actionName }
    }
    return { formType: 'system', action: '' }
  }

  function formToButton(existingCtx: string): Button {
    let actionUUID: string
    let settings: Record<string, unknown>
    if (formType === 'browser') {
      actionUUID = 'com.pannacotta.browser.open-url'
      settings = { url: action.trim() }
    } else if (MEDIA_ACTIONS.includes(action.trim())) {
      actionUUID = `com.pannacotta.system.${action.trim()}`
      settings = {}
    } else {
      actionUUID = 'com.pannacotta.system.open-app'
      settings = { appName: action.trim() }
    }
    const context = existingCtx || Math.random().toString(36).slice(2, 14)
    return { name: name.trim(), icon: icon.trim(), actionUUID, context, settings }
  }

  $: selectedBtn = selectedIndex >= 0 ? (config.buttons[selectedIndex] ?? null) : null
  $: isEditing = selectedBtn !== null
  $: pluginAction = selectedBtn ? findPluginAction(selectedBtn.actionUUID) : null
  $: isBuiltIn = selectedBtn ? isBuiltInUUID(selectedBtn.actionUUID) : true
  $: hasPi = !isBuiltIn && pluginAction?.action.piPath != null
  $: showJsonEditor = !isBuiltIn && !hasPi && pluginAction != null

  $: piUrl = hasPi && serverInfo && selectedBtn && pluginAction?.action.piPath
    ? (() => {
        const { plugin, action: act } = pluginAction!
        const actionInfo = JSON.stringify({
          action: selectedBtn!.actionUUID,
          context: selectedBtn!.context,
          device: '',
          payload: { settings: selectedBtn!.settings ?? {} },
        })
        const params = new URLSearchParams({
          port: String(serverInfo!.port),
          uuid: selectedBtn!.context,
          registerEvent: 'registerPropertyInspector',
          info: '{}',
          actionInfo,
        })
        return `http://127.0.0.1:${serverInfo!.port}/pi/${plugin.uuid}/${act.piPath}?${params.toString()}`
      })()
    : null

  $: if (selectedIndex >= 0) {
    const btn = config.buttons[selectedIndex]
    if (btn) {
      name = btn.name
      icon = btn.icon
      if (isBuiltIn) {
        const f = buttonToForm(btn)
        formType = f.formType
        action = f.action
      } else {
        jsonSettings = JSON.stringify(btn.settings ?? {}, null, 2)
      }
    } else {
      name = ''; formType = 'browser'; icon = ''; action = ''; jsonSettings = '{}'
    }
  }

  export function prefill(btn: Partial<Button>) {
    if (btn.name !== undefined) name = btn.name
    if (btn.icon !== undefined) icon = btn.icon
    if (btn.actionUUID !== undefined) {
      if (isBuiltInUUID(btn.actionUUID)) {
        const f = buttonToForm({ actionUUID: btn.actionUUID, settings: btn.settings ?? {}, name: '', icon: '', context: '' })
        formType = f.formType
        action = f.action
      } else {
        jsonSettings = JSON.stringify(btn.settings ?? {}, null, 2)
      }
    }
  }

  function toast(message: string, ok: boolean) { dispatch('toast', { message, ok }) }

  async function handleSave() {
    if (!name.trim() || !icon.trim()) {
      toast('Fill in name and icon', false); return
    }
    let btn: Button
    if (isBuiltIn) {
      if (!action.trim()) { toast('Fill in all fields', false); return }
      const existingCtx = selectedBtn?.context ?? ''
      btn = formToButton(existingCtx)
      btn.name = name.trim()
      btn.icon = icon.trim()
    } else if (pluginAction) {
      let parsedSettings: Record<string, unknown> = {}
      if (!hasPi) {
        try {
          parsedSettings = JSON.parse(jsonSettings)
        } catch {
          toast('Settings JSON is invalid', false); return
        }
      } else {
        // PI persists settings via WS; Save here snapshots selectedBtn.settings as-is.
        parsedSettings = selectedBtn?.settings ?? {}
      }
      const context = selectedBtn?.context || Math.random().toString(36).slice(2, 14)
      btn = { name: name.trim(), icon: icon.trim(), actionUUID: pluginAction.action.uuid, context, settings: parsedSettings }
    } else {
      toast('Unknown action type', false); return
    }
    const newButtons = [...config.buttons]
    if (selectedIndex >= 0) {
      while (newButtons.length <= selectedIndex) newButtons.push(null as unknown as Button)
      newButtons[selectedIndex] = btn
    } else {
      newButtons.push(btn)
    }
    await saveConfig({ ...config, buttons: newButtons.filter(Boolean) })
      .then(() => { toast('Saved!', true); dispatch('save') })
      .catch(e => toast(String(e), false))
  }

  async function handleDelete() {
    if (selectedIndex < 0) return
    const newButtons = config.buttons.filter((_, i) => i !== selectedIndex)
    await saveConfig({ ...config, buttons: newButtons })
      .then(() => { toast('Deleted', true); dispatch('save') })
      .catch(e => toast(String(e), false))
  }

  function handleClear() {
    name = ''; formType = 'browser'; icon = ''; action = ''; jsonSettings = '{}'
  }
</script>

<div class="editor-panel">
  <div class="editor-header">
    <span class="editor-title">
      {isEditing ? `Edit: ${selectedBtn?.name ?? ''}` : selectedIndex >= 0 ? `Add to slot ${selectedIndex + 1}` : 'Add Button'}
    </span>
  </div>

  <div class="editor-fields">
    <div class="field"><label for="btn-name">Name</label><input id="btn-name" bind:value={name} placeholder="GitHub" /></div>
    <div class="field"><label for="btn-icon">Icon (Lucide name)</label><input id="btn-icon" bind:value={icon} placeholder="github" /></div>

    {#if isBuiltIn}
      <div class="field">
        <label for="btn-type">Type</label>
        <select id="btn-type" bind:value={formType}>
          <option value="browser">browser</option>
          <option value="system">system</option>
        </select>
      </div>
      <div class="field full"><label for="btn-action">Action (URL or app name)</label><input id="btn-action" bind:value={action} placeholder="https://github.com" /></div>
    {:else if hasPi && piUrl}
      <div class="field full pi-wrapper">
        <label>Property Inspector</label>
        <iframe title="Property Inspector" src={piUrl} class="pi-frame" sandbox="allow-scripts allow-forms"></iframe>
      </div>
    {:else if showJsonEditor}
      <div class="field full">
        <label for="btn-json">Settings (JSON)</label>
        <textarea id="btn-json" bind:value={jsonSettings} rows="4" spellcheck="false"></textarea>
      </div>
    {:else if selectedBtn && !isBuiltIn && !pluginAction}
      <div class="field full">
        <p class="unknown-action">Unknown action: {selectedBtn.actionUUID}</p>
      </div>
    {/if}
  </div>

  <div class="editor-actions">
    <button class="btn" on:click={handleSave}>{isEditing ? 'Update' : 'Add'}</button>
    <button class="btn secondary" on:click={handleClear}>Clear</button>
    {#if isEditing}
      <button class="btn danger" on:click={handleDelete}>Delete</button>
    {/if}
  </div>
</div>

<style>
  .editor-panel { background: #252527; border-radius: 0.6rem; padding: 0.75rem; }
  .editor-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem; }
  .editor-title { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .editor-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .field { display: flex; flex-direction: column; gap: 0.2rem; }
  .field label { font-size: 0.7rem; color: #777; }
  .field input, .field select, .field textarea { background: #1c1c1e; border: 1px solid #3a3a3c; color: #f0f0f0; padding: 0.32rem 0.55rem; border-radius: 0.35rem; font-size: 0.82rem; width: 100%; }
  .field textarea { resize: vertical; font-family: monospace; }
  .field input:focus, .field select:focus, .field textarea:focus { outline: 1px solid #4f46e5; border-color: #4f46e5; }
  .field.full { grid-column: 1/-1; }
  .pi-wrapper { gap: 0.35rem; }
  .pi-frame { width: 100%; height: 240px; border: 1px solid #3a3a3c; border-radius: 0.35rem; background: #1c1c1e; }
  .unknown-action { font-size: 0.75rem; color: #f87171; margin: 0; }
  .editor-actions { display: flex; gap: 0.4rem; margin-top: 0.55rem; }
  .btn { background: #4f46e5; color: #fff; border: none; padding: 0.35rem 0.85rem; border-radius: 0.35rem; cursor: pointer; font-size: 0.8rem; }
  .btn:hover { background: #6366f1; }
  .btn.secondary { background: #2a2a2c; border: 1px solid #3a3a3c; color: #ccc; }
  .btn.secondary:hover { background: #3a3a3c; color: #f0f0f0; }
  .btn.danger { background: transparent; color: #f87171; border: 1px solid #3a3a3c; }
  .btn.danger:hover { background: #2e1a1a; border-color: #f87171; }
</style>
