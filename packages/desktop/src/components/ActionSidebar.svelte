<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { Button } from '../lib/types'

  const dispatch = createEventDispatcher<{ use: Partial<Button> }>()

  let query = ''

  const ACTION_GROUPS = [
    { name: 'Browser', icon: '🌐', items: [
      { name: 'Open URL', icon: '🔗', actionUUID: 'com.pannacotta.browser.open-url', settings: { url: 'https://' }, iconName: 'link' },
    ]},
    { name: 'System', icon: '⚙️', items: [
      { name: 'Open App', icon: '🖥', actionUUID: 'com.pannacotta.system.open-app', settings: { appName: '' }, iconName: 'terminal' },
      { name: 'Volume Up', icon: '🔊', actionUUID: 'com.pannacotta.system.volume-up', settings: {}, iconName: 'volume-2' },
      { name: 'Volume Down', icon: '🔉', actionUUID: 'com.pannacotta.system.volume-down', settings: {}, iconName: 'volume-1' },
      { name: 'Mute Toggle', icon: '🔇', actionUUID: 'com.pannacotta.system.volume-mute', settings: {}, iconName: 'volume-x' },
      { name: 'Brightness Up', icon: '☀️', actionUUID: 'com.pannacotta.system.brightness-up', settings: {}, iconName: 'sun' },
      { name: 'Brightness Down', icon: '🌙', actionUUID: 'com.pannacotta.system.brightness-down', settings: {}, iconName: 'moon' },
      { name: 'Sleep', icon: '💤', actionUUID: 'com.pannacotta.system.sleep', settings: {}, iconName: 'power' },
      { name: 'Lock Screen', icon: '🔒', actionUUID: 'com.pannacotta.system.lock', settings: {}, iconName: 'lock' },
    ]},
  ]

  $: filtered = ACTION_GROUPS.map(g => ({
    ...g,
    items: query
      ? g.items.filter(i => i.name.toLowerCase().includes(query.toLowerCase()))
      : g.items,
  })).filter(g => g.items.length > 0)
</script>

<div class="right-panel">
  <div class="right-header">
    <input class="search-input" type="search" placeholder="Search actions…" bind:value={query} />
  </div>
  <div class="actions-list">
    {#each filtered as group}
      <div class="action-group">
        <div class="action-group-header">{group.icon} {group.name}</div>
        <div class="action-group-items">
          {#each group.items as item}
            <button
              class="action-item"
              on:click={() => dispatch('use', { name: item.name, actionUUID: item.actionUUID, icon: item.iconName, settings: item.settings })}
            >
              <span class="action-item-icon">{item.icon}</span>
              {item.name}
            </button>
          {/each}
        </div>
      </div>
    {/each}
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
  .action-group-items { display: flex; flex-direction: column; gap: 1px; }
  .action-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.6rem; border-radius: 0.35rem; font-size: 0.8rem; color: #bbb; cursor: pointer; background: none; border: none; width: 100%; text-align: left; }
  .action-item:hover { background: #2a2a2c; color: #f0f0f0; }
  .action-item-icon { width: 1.1rem; text-align: center; font-size: 0.9rem; flex-shrink: 0; }
</style>
