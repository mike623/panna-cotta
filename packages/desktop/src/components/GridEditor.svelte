<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { StreamDeckConfig, PluginRenderState } from '../lib/types'

  export let config: StreamDeckConfig
  export let selectedIndex: number = -1
  export let pluginRender: PluginRenderState = { images: {}, titles: {}, states: {} }

  const dispatch = createEventDispatcher<{ select: number }>()

  const ICON_MAP: Record<string, string> = {
    github:'⬡', link:'🔗', globe:'🌐', chrome:'🌐', terminal:'🖥',
    'volume-2':'🔊', 'volume-1':'🔉', 'volume-x':'🔇', sun:'☀️', moon:'🌙',
    power:'⏻', lock:'🔒', calculator:'🧮', youtube:'▶', twitch:'📺',
    reddit:'🔴', mail:'✉️', spotify:'♫', discord:'💬', code:'</>',
  }

  function iconEmoji(name: string): string {
    return ICON_MAP[name] ?? (name ? name.slice(0, 2).toUpperCase() : '?')
  }

  $: rows = config.grid.rows
  $: cols = config.grid.cols
  $: total = rows * cols
  $: cells = Array.from({ length: total }, (_, i) => config.buttons[i] ?? null)
</script>

<div class="grid-settings">
  <span class="section-label">Grid</span>
  <span class="dim">Rows</span>
  <input type="number" min="1" max="10" bind:value={config.grid.rows} />
  <span class="dim">Cols</span>
  <input type="number" min="1" max="10" bind:value={config.grid.cols} />
</div>

<div class="grid-preview" style="grid-template-columns: repeat({cols}, 72px)">
  {#each cells as btn, i}
    <button
      class="grid-cell"
      class:empty={!btn}
      class:selected={selectedIndex === i}
      on:click={() => dispatch('select', i)}
    >
      {#if btn}
        {#if pluginRender.images[btn.context]}
          <img
            src={pluginRender.images[btn.context]}
            alt=""
            class="cell-plugin-img"
          />
        {:else}
          <span class="cell-icon">{iconEmoji(btn.icon)}</span>
        {/if}
        <span class="cell-label">{pluginRender.titles[btn.context] ?? btn.name}</span>
      {:else}
        <span class="cell-icon" style="opacity:0.4;font-size:1.1rem">+</span>
      {/if}
      <span class="cell-idx">{i + 1}</span>
    </button>
  {/each}
</div>

<style>
  .grid-settings { display: flex; align-items: center; gap: 0.6rem; font-size: 0.8rem; color: #888; }
  .section-label { font-size: 0.7rem; color: #666; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; }
  .dim { color: #666; }
  input { background: #2a2a2c; border: 1px solid #3a3a3c; color: #f0f0f0; padding: 0.25rem 0.4rem; border-radius: 0.3rem; width: 3.2rem; font-size: 0.8rem; text-align: center; }
  .grid-preview { display: grid; gap: 0.45rem; background: #252527; padding: 0.875rem; border-radius: 0.6rem; width: fit-content; }
  .grid-cell {
    width: 72px; height: 72px; background: #3a3a3c; border-radius: 0.5rem;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; cursor: pointer; border: 2px solid transparent;
    transition: border-color 0.1s, background 0.1s;
    overflow: hidden; padding: 4px; position: relative;
  }
  .grid-cell:hover { background: #464648; }
  .grid-cell.selected { border-color: #4f46e5; background: #1e1a3a; }
  .grid-cell.empty { opacity: 0.35; }
  .grid-cell.empty:hover { opacity: 0.6; }
  .cell-icon { font-size: 1.5rem; line-height: 1; }
  .cell-plugin-img { width: 48px; height: 48px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
  .cell-label { font-size: 0.58rem; color: #ccc; text-align: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 66px; }
  .cell-idx { position: absolute; top: 3px; right: 4px; font-size: 0.5rem; color: #555; }
</style>
