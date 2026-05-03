<script lang="ts">
  import { onMount } from 'svelte'
  import './app.css'
  import ProfileSelector from './components/ProfileSelector.svelte'
  import GridEditor from './components/GridEditor.svelte'
  import ButtonEditor from './components/ButtonEditor.svelte'
  import ActionSidebar from './components/ActionSidebar.svelte'
  import { getConfig, getDefaultConfig, listProfiles, openConfigFolder, getServerInfo } from './lib/invoke'
  import type { StreamDeckConfig, Profile, ServerInfo } from './lib/types'

  let config: StreamDeckConfig | null = null
  let profiles: Profile[] = []
  let selectedIndex = -1
  let serverInfo: ServerInfo | null = null
  let toastMsg = ''
  let toastOk = true
  let toastVisible = false
  let toastTimer: ReturnType<typeof setTimeout>
  let editorRef: ButtonEditor

  function showToast(message: string, ok: boolean) {
    toastMsg = message; toastOk = ok; toastVisible = true
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastVisible = false }, 2500)
  }

  async function reload() {
    const [cfg, profs, info] = await Promise.all([getConfig(), listProfiles(), getServerInfo()])
    config = cfg
    profiles = profs
    serverInfo = info
    selectedIndex = -1
  }

  async function handleReset() {
    if (!confirm('Reset to defaults? This overwrites the current profile.')) return
    config = await getDefaultConfig()
    showToast('Defaults loaded — click Save to apply', true)
  }

  onMount(reload)
</script>

<div class="topbar">
  <span class="app-title">Panna Cotta</span>
  <ProfileSelector
    {profiles}
    on:change={reload}
    on:toast={e => showToast(e.detail.message, e.detail.ok)}
  />
  <div class="spacer"></div>
  <button class="btn secondary" on:click={openConfigFolder}>📂 Config Folder</button>
  <button class="btn secondary" on:click={handleReset}>Reset</button>
</div>

{#if config}
  <div class="main">
    <div class="left-panel">
      <GridEditor
        {config}
        {selectedIndex}
        on:select={e => { selectedIndex = e.detail }}
      />
      <div class="divider"></div>
      <ButtonEditor
        bind:this={editorRef}
        {config}
        {selectedIndex}
        on:save={reload}
        on:toast={e => showToast(e.detail.message, e.detail.ok)}
      />
    </div>
    <ActionSidebar
      on:use={e => editorRef?.prefill(e.detail)}
    />
  </div>
  {#if serverInfo}
    {@const lanUrl = `http://${serverInfo.ip}:${serverInfo.port}/apps/`}
    <div class="qr-panel">
      <img
        class="qr-img"
        src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(lanUrl)}`}
        alt="QR code"
      />
      <span class="qr-url">{lanUrl}</span>
    </div>
  {/if}
{/if}

{#if toastVisible}
  <div class="toast-bar" class:ok={toastOk} class:err={!toastOk}>{toastMsg}</div>
{/if}

<style>
  .topbar { display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 1rem; background: #141416; border-bottom: 1px solid #3a3a3c; flex-shrink: 0; }
  .app-title { font-size: 0.9rem; font-weight: 600; white-space: nowrap; }
  .spacer { flex: 1; }
  .main { display: flex; flex: 1; overflow: hidden; }
  .left-panel { flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding: 0.875rem; gap: 0.75rem; min-width: 0; }
  .divider { height: 1px; background: #3a3a3c; flex-shrink: 0; }
  .btn { background: #4f46e5; color: #fff; border: none; padding: 0.35rem 0.85rem; border-radius: 0.35rem; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
  .btn:hover { background: #6366f1; }
  .btn.secondary { background: #2a2a2c; border: 1px solid #3a3a3c; color: #ccc; }
  .btn.secondary:hover { background: #3a3a3c; color: #f0f0f0; }
  .toast-bar { position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%); background: #2a2a2c; border: 1px solid #3a3a3c; padding: 0.45rem 1.1rem; border-radius: 2rem; font-size: 0.82rem; white-space: nowrap; }
  .toast-bar.ok { border-color: #4ade80; color: #4ade80; }
  .toast-bar.err { border-color: #f87171; color: #f87171; }
  .qr-panel { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 0.875rem; border-top: 1px solid #3a3a3c; }
  .qr-img { width: 180px; height: 180px; border-radius: 0.35rem; }
  .qr-url { font-size: 0.75rem; color: #888; word-break: break-all; text-align: center; }
</style>
