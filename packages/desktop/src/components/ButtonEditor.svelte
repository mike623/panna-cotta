<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { saveConfig } from '../lib/invoke'
  import type { Button, StreamDeckConfig } from '../lib/types'

  export let config: StreamDeckConfig
  export let selectedIndex: number = -1

  const dispatch = createEventDispatcher<{
    save: void
    toast: { message: string; ok: boolean }
  }>()

  let name = ''
  let type: 'browser' | 'system' = 'browser'
  let icon = ''
  let action = ''

  $: selectedBtn = selectedIndex >= 0 ? (config.buttons[selectedIndex] ?? null) : null
  $: isEditing = selectedBtn !== null

  $: if (selectedIndex >= 0) {
    const btn = config.buttons[selectedIndex]
    if (btn) {
      name = btn.name; type = btn.type as 'browser' | 'system'; icon = btn.icon; action = btn.action
    } else {
      name = ''; type = 'browser'; icon = ''; action = ''
    }
  }

  export function prefill(btn: Partial<Button>) {
    if (btn.name !== undefined) name = btn.name
    if (btn.type !== undefined) type = btn.type as 'browser' | 'system'
    if (btn.icon !== undefined) icon = btn.icon
    if (btn.action !== undefined) action = btn.action
  }

  function toast(message: string, ok: boolean) { dispatch('toast', { message, ok }) }

  async function handleSave() {
    if (!name.trim() || !icon.trim() || !action.trim()) {
      toast('Fill in all fields', false); return
    }
    const btn: Button = { name: name.trim(), type, icon: icon.trim(), action: action.trim() }
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
    name = ''; type = 'browser'; icon = ''; action = ''
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
    <div class="field">
      <label for="btn-type">Type</label>
      <select id="btn-type" bind:value={type}>
        <option value="browser">browser</option>
        <option value="system">system</option>
      </select>
    </div>
    <div class="field"><label for="btn-icon">Icon (Lucide name)</label><input id="btn-icon" bind:value={icon} placeholder="github" /></div>
    <div class="field full"><label for="btn-action">Action (URL or app name)</label><input id="btn-action" bind:value={action} placeholder="https://github.com" /></div>
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
  .field input, .field select { background: #1c1c1e; border: 1px solid #3a3a3c; color: #f0f0f0; padding: 0.32rem 0.55rem; border-radius: 0.35rem; font-size: 0.82rem; width: 100%; }
  .field input:focus, .field select:focus { outline: 1px solid #4f46e5; border-color: #4f46e5; }
  .field.full { grid-column: 1/-1; }
  .editor-actions { display: flex; gap: 0.4rem; margin-top: 0.55rem; }
  .btn { background: #4f46e5; color: #fff; border: none; padding: 0.35rem 0.85rem; border-radius: 0.35rem; cursor: pointer; font-size: 0.8rem; }
  .btn:hover { background: #6366f1; }
  .btn.secondary { background: #2a2a2c; border: 1px solid #3a3a3c; color: #ccc; }
  .btn.secondary:hover { background: #3a3a3c; color: #f0f0f0; }
  .btn.danger { background: transparent; color: #f87171; border: 1px solid #3a3a3c; }
  .btn.danger:hover { background: #2e1a1a; border-color: #f87171; }
</style>
