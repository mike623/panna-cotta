<script lang="ts">
  import { onMount } from 'svelte'
  import { createEventDispatcher } from 'svelte'
  import { listPlugins } from '../lib/invoke'
  import type { Button, PluginInfo } from '../lib/types'

  const dispatch = createEventDispatcher<{ use: Partial<Button> }>()

  let query = ''
  let plugins: PluginInfo[] = []
  let loadError = ''
  let loading = true

  onMount(async () => {
    try {
      plugins = await listPlugins()
    } catch (e) {
      loadError = String(e)
    } finally {
      loading = false
    }
  })

  function statusBadge(status: PluginInfo['status']): string {
    switch (status) {
      case 'running':    return '🟢'
      case 'starting':   return '🟡'
      case 'errored':    return '🔴'
      default:           return '⚫'
    }
  }

  $: filtered = plugins.map(p => ({
    ...p,
    actions: query
      ? p.actions.filter(a => a.name.toLowerCase().includes(query.toLowerCase()))
      : p.actions,
  })).filter(p => p.actions.length > 0)
</script>

<div class="right-panel">
  <div class="right-header">
    <input class="search-input" type="search" placeholder="Search actions…" bind:value={query} />
  </div>
  <div class="actions-list">
    {#if loadError}
      <p class="load-error">{loadError}</p>
    {:else if loading}
      <p class="empty">Loading…</p>
    {:else if plugins.length === 0}
      <p class="empty">No plugins loaded</p>
    {:else}
      {#each filtered as plugin}
        <div class="action-group">
          <div class="action-group-header">
            <span class="status-dot">{statusBadge(plugin.status)}</span>
            {plugin.name}
          </div>
          <div class="action-group-items">
            {#each plugin.actions as action}
              <button
                class="action-item"
                on:click={() => dispatch('use', {
                  name: action.name,
                  actionUUID: action.uuid,
                  settings: {},
                })}
              >
                {action.name}
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <p class="empty">No actions match "{query}"</p>
      {/each}
    {/if}
  </div>
</div>

<style>
  .right-panel { width: 220px; border-left: 1px solid #3a3a3c; display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; }
  .right-header { padding: 0.65rem 0.65rem 0.5rem; flex-shrink: 0; border-bottom: 1px solid #3a3a3c; }
  .search-input { width: 100%; background: #2a2a2c; border: 1px solid #3a3a3c; color: #f0f0f0; padding: 0.35rem 0.65rem; border-radius: 0.35rem; font-size: 0.8rem; }
  .search-input::placeholder { color: #555; }
  .search-input:focus { outline: 1px solid #4f46e5; border-color: #4f46e5; }
  .actions-list { flex: 1; overflow-y: auto; padding: 0.4rem 0.4rem 0.75rem; }
  .action-group { margin-top: 0.35rem; }
  .action-group-header { display: flex; align-items: center; gap: 0.35rem; font-size: 0.68rem; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.07em; padding: 0.35rem 0.4rem 0.2rem; }
  .status-dot { font-size: 0.6rem; flex-shrink: 0; }
  .action-group-items { display: flex; flex-direction: column; gap: 1px; }
  .action-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.6rem; border-radius: 0.35rem; font-size: 0.8rem; color: #bbb; cursor: pointer; background: none; border: none; width: 100%; text-align: left; }
  .action-item:hover { background: #2a2a2c; color: #f0f0f0; }
  .empty { font-size: 0.75rem; color: #555; padding: 0.5rem 0.4rem; }
  .load-error { font-size: 0.75rem; color: #f87171; padding: 0.5rem 0.4rem; word-break: break-all; }
</style>
