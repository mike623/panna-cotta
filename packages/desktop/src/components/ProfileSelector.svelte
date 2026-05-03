<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { activateProfile, createProfile, deleteProfile, renameProfile } from '../lib/invoke'
  import type { Profile } from '../lib/types'

  export let profiles: Profile[] = []

  const dispatch = createEventDispatcher<{
    change: void
    toast: { message: string; ok: boolean }
  }>()

  function toast(message: string, ok: boolean) {
    dispatch('toast', { message, ok })
  }

  async function handleSwitch(name: string) {
    await activateProfile(name).catch(e => toast(String(e), false))
    dispatch('change')
  }

  async function handleNew() {
    const name = prompt('New profile name:')?.trim()
    if (!name) return
    await createProfile(name).catch(e => toast(String(e), false))
    dispatch('change')
  }

  async function handleRename() {
    const current = profiles.find(p => p.isActive)?.name
    if (!current) return
    const newName = prompt(`Rename "${current}" to:`)?.trim()
    if (!newName || newName === current) return
    await renameProfile(current, newName).catch(e => toast(String(e), false))
    dispatch('change')
  }

  async function handleDelete() {
    const current = profiles.find(p => p.isActive)?.name
    if (!current || !confirm(`Delete profile "${current}"? This cannot be undone.`)) return
    await deleteProfile(current).catch(e => toast(String(e), false))
    dispatch('change')
  }
</script>

<div class="profile-section">
  <select class="profile-select" on:change={e => handleSwitch(e.currentTarget.value)}>
    {#each profiles as profile}
      <option value={profile.name} selected={profile.isActive}>{profile.name}</option>
    {/each}
  </select>
  <button class="icon-btn" on:click={handleNew} title="New profile">+</button>
  <button class="icon-btn" on:click={handleRename} title="Rename profile">✎</button>
  <button class="icon-btn" on:click={handleDelete} title="Delete profile">×</button>
</div>

<style>
  .profile-section { display: flex; align-items: center; gap: 0.3rem; margin-left: 0.5rem; }
  .profile-select {
    background: #2a2a2c; border: 1px solid #3a3a3c; color: #f0f0f0;
    padding: 0.28rem 0.5rem; border-radius: 0.35rem; font-size: 0.8rem;
    cursor: pointer; max-width: 120px;
  }
  .icon-btn {
    background: #2a2a2c; border: 1px solid #3a3a3c; color: #aaa;
    padding: 0.28rem 0.55rem; border-radius: 0.35rem; cursor: pointer;
    font-size: 0.75rem; line-height: 1;
  }
  .icon-btn:hover { background: #3a3a3c; color: #f0f0f0; }
</style>
