// ── Inline SVG icon set (no external deps) ───────────────────
const ICON_PATHS = {
  globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  app:      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  volup:    '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/>',
  voldown:  '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 10l4 4M20 10l-4 4"/>',
  mute:     '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  moon:     '<path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10z"/>',
  sleep:    '<path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10z"/><path d="M14 4h4l-4 4h4"/>',
  lock:     '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  play:     '<path d="M7 5l12 7-12 7z"/>',
  next:     '<path d="M5 5l10 7-10 7z"/><path d="M17 5v14"/>',
  prev:     '<path d="M19 5l-10 7 10 7z"/><path d="M7 5v14"/>',
  cmd:      '<path d="M8 8a2 2 0 1 1 2-2v12a2 2 0 1 1-2-2h8a2 2 0 1 1-2 2V6a2 2 0 1 1 2 2H8z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  spark:    '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  folder:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  home:     '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z"/>',
  broadcast:'<circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  calc:     '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0M8 19h2M12 19h2M16 19h0"/>',
  code:     '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
  chat:     '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
  mail:     '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  video:    '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  zap:      '<path d="M13 3L4 14h7l-1 7 9-11h-7z"/>',
  x:        '<path d="M6 6l12 12M18 6l-6 6 0 0L6 18"/>',
  'wifi-off':'<path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
};

function createIcon(name, size = 20, color = 'currentColor', strokeWidth = 1.6) {
  const paths = ICON_PATHS[name] || ICON_PATHS.spark;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color);
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.flexShrink = '0';
  svg.innerHTML = paths;
  return svg;
}

// Sara SVG mark (皿 — top-down plate with 3×3 dot grid)
function createSaraMark(size = 20, accent = '#C8472E') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.style.display = 'block';
  svg.style.flexShrink = '0';
  const G = [35, 50, 65];
  let inner = `<rect width="100" height="100" rx="24" fill="#EFE7D6"/>
    <circle cx="50" cy="50" r="31" fill="#F6F1E8" stroke="#211F1B" stroke-opacity="0.16" stroke-width="1.4"/>
    <circle cx="50" cy="50" r="24" fill="none" stroke="#211F1B" stroke-opacity="0.10" stroke-width="1"/>`;
  G.forEach((y, ri) => G.forEach((x, ci) => {
    const active = ri === 1 && ci === 1;
    inner += `<circle cx="${x}" cy="${y}" r="${active ? 4.8 : 3.8}" fill="${active ? accent : '#211F1B'}" fill-opacity="${active ? 1 : 0.82}"/>`;
  }));
  svg.innerHTML = inner;
  return svg;
}

function renderPanelHeader() {
  const el = document.getElementById('panel-header');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(createSaraMark(20, '#C8472E'));
  const wordmark = document.createElement('span');
  wordmark.className = 'panel-header-wordmark';
  wordmark.textContent = 'Panna Cotta';
  el.appendChild(wordmark);
}

class StreamDeckAPI {
  constructor() {
    this.baseUrl = `${window.location.protocol}//${window.location.host}`;
  }

  async getConfig() {
    const response = await fetch(`${this.baseUrl}/api/config`);
    if (!response.ok) {
      throw new Error(`Config fetch failed: ${response.status}`);
    }
    return response.json();
  }

  async ping() {
    const response = await fetch(`${this.baseUrl}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  }

}

const api = new StreamDeckAPI();
let currentPage = 0;
let config;
let connectionLost = false;
let viewMode = localStorage.getItem("viewMode") || "grid";
let pluginRender = { images: {}, titles: {}, states: {} };
let autocompleteWords = [];
let autocompleteSource = null;

const HEALTH_PING_INTERVAL = 5000;
const HEALTH_BACKOFF_MAX = 60000;
const HEALTH_MAX_FAILURES = 6;
let healthTimeoutId = null;
let healthFailCount = 0;

function updateBanner(state, secondsLeft) {
  // Remove existing banners
  document.querySelectorAll('.banner').forEach(b => b.remove());
  connectionLost = state !== 'online';
  if (state === 'online') return;

  const banner = document.createElement('div');
  banner.className = state === 'gave-up'
    ? 'banner banner-conn'
    : 'banner banner-conn';

  const icon = createIcon('wifi-off', 17, '#fff', 2);
  banner.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'banner-text';
  text.textContent = state === 'retrying'
    ? `Backend disconnected — retrying in ${secondsLeft}s`
    : 'Backend disconnected';
  banner.appendChild(text);

  if (state === 'gave-up') {
    const btn = document.createElement('button');
    btn.className = 'banner-close';
    btn.textContent = 'Retry';
    btn.style.cssText = 'font-size:11px;font-weight:600;background:rgba(255,255,255,0.25);border:1px solid rgba(255,255,255,0.5);border-radius:6px;padding:2px 8px;color:#fff;cursor:pointer;';
    btn.addEventListener('click', manualHealthRetry);
    banner.appendChild(btn);
  } else {
    const spin = document.createElement('span');
    spin.className = 'banner-spin';
    banner.appendChild(spin);
  }

  // Insert after header
  const header = document.getElementById('panel-header');
  header ? header.after(banner) : document.body.prepend(banner);
}

function manualHealthRetry() {
  healthFailCount = 0;
  scheduleHealthPing(0);
}

async function fetchPluginRender() {
  try {
    const resp = await fetch(`${api.baseUrl}/api/plugin-render`);
    if (resp.ok) {
      pluginRender = await resp.json();
    }
  } catch {
    // Non-fatal: render state is best-effort
  }
}

function scheduleHealthPing(delayMs) {
  clearTimeout(healthTimeoutId);
  healthTimeoutId = setTimeout(doHealthPing, delayMs);
}

async function doHealthPing() {
  try {
    const ok = await api.ping();
    if (!ok) throw new Error();
    healthFailCount = 0;
    updateBanner("online");
    await fetchPluginRender();
    scheduleHealthPing(HEALTH_PING_INTERVAL);
  } catch {
    healthFailCount++;
    if (healthFailCount >= HEALTH_MAX_FAILURES) {
      updateBanner("gave-up");
    } else {
      const backoffMs = Math.min(HEALTH_PING_INTERVAL * Math.pow(2, healthFailCount - 1), HEALTH_BACKOFF_MAX);
      updateBanner("retrying", Math.round(backoffMs / 1000));
      scheduleHealthPing(backoffMs);
    }
  }
}

function startHealthPing() {
  scheduleHealthPing(HEALTH_PING_INTERVAL);
}

function renderSuggestionStrip() {
  const strip = document.getElementById("suggestion-strip");
  if (!strip) return;
  strip.innerHTML = "";
  autocompleteWords.forEach((word) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = word;

    let longPressTimer = null;
    let didLongPress = false;

    chip.addEventListener("touchstart", (e) => {
      didLongPress = false;
      longPressTimer = setTimeout(() => {
        didLongPress = true;
        chip.classList.add("long-pressed");
        handleChipAction(word, "clipboard");
      }, 500);
    }, { passive: true });

    chip.addEventListener("touchend", () => {
      clearTimeout(longPressTimer);
      chip.classList.remove("long-pressed");
      if (!didLongPress) {
        handleChipAction(word, "type");
      }
    });

    chip.addEventListener("touchcancel", () => {
      clearTimeout(longPressTimer);
      chip.classList.remove("long-pressed");
    });

    // Desktop fallback: click = type
    chip.addEventListener("click", () => {
      if (!didLongPress) handleChipAction(word, "type");
    });

    strip.appendChild(chip);
  });
}

async function handleChipAction(word, action) {
  try {
    await fetch(`${api.baseUrl}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, text: word }),
    });
  } catch (err) {
    console.error("chip action failed:", err);
  }
}

function startAutocompleteSSE() {
  if (autocompleteSource) autocompleteSource.close();
  autocompleteSource = new EventSource(`${api.baseUrl}/api/autocomplete`);

  autocompleteSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (Array.isArray(data.words)) {
        autocompleteWords = data.words;
        renderSuggestionStrip();
      }
    } catch (_) {}
  };

  autocompleteSource.onerror = () => {
    autocompleteSource.close();
    autocompleteSource = null;
    // Reconnect with 3s backoff
    setTimeout(startAutocompleteSSE, 3000);
  };
}

function flashButton(button, className) {
  button.classList.add(className);
  setTimeout(() => button.classList.remove(className), 600);
}

async function handleButtonPress(button, buttonConfig) {
  button.classList.add("button-loading");
  try {
    const response = await fetch(`${api.baseUrl}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: buttonConfig.context }),
    });
    if (!response.ok) throw new Error(`Execute failed: ${response.status}`);
    flashButton(button, "button-success");
  } catch (err) {
    console.error("Button action failed:", err);
    flashButton(button, "button-error");
  } finally {
    button.classList.remove("button-loading");
  }
}

function renderGrid() {
  const gridContainer = document.getElementById("grid-container");
  gridContainer.className = "grid-container";
  gridContainer.innerHTML = "";
  gridContainer.style.gridTemplateRows = `repeat(${config.grid.rows}, 1fr)`;
  gridContainer.style.gridTemplateColumns = `repeat(${config.grid.cols}, 1fr)`;

  const totalCells = config.grid.rows * config.grid.cols;
  const startIndex = currentPage * totalCells;
  const endIndex = startIndex + totalCells;
  const buttonsToShow = config.buttons?.slice(startIndex, endIndex) || [];

  for (let i = 0; i < totalCells; i++) {
    const buttonConfig = buttonsToShow[i];
    const button = document.createElement("div");
    button.className = "grid-button";

    if (buttonConfig) {
      const pluginImage = pluginRender.images?.[buttonConfig.context];
      const pluginTitle = pluginRender.titles?.[buttonConfig.context];

      if (pluginImage) {
        const img = document.createElement("img");
        img.src = pluginImage;
        img.className = "button-plugin-img";
        img.alt = "";
        button.appendChild(img);
      } else {
        button.appendChild(createIcon(buttonConfig.icon, 24, 'currentColor', 1.7));
      }

      const label = document.createElement("span");
      label.className = "button-label";
      label.textContent = pluginTitle ?? buttonConfig.name;
      button.appendChild(label);

      button.addEventListener("click", () => handleButtonPress(button, buttonConfig));
    }

    gridContainer.appendChild(button);
  }

  updatePageIndicator();
}

function renderList() {
  const gridContainer = document.getElementById("grid-container");
  gridContainer.className = "list-container";
  gridContainer.style.gridTemplateRows = "";
  gridContainer.style.gridTemplateColumns = "";
  gridContainer.innerHTML = "";

  const buttons = config.buttons || [];
  for (const buttonConfig of buttons) {
    const item = document.createElement("div");
    item.className = "list-item";

    const pluginImage = pluginRender.images?.[buttonConfig.context];
    const pluginTitle = pluginRender.titles?.[buttonConfig.context];

    if (pluginImage) {
      const img = document.createElement("img");
      img.src = pluginImage;
      img.className = "list-item-plugin-img";
      img.alt = "";
      item.appendChild(img);
    } else {
      item.appendChild(createIcon(buttonConfig.icon, 22, 'currentColor', 1.7));
    }

    const name = document.createElement("span");
    name.className = "list-item-name";
    name.textContent = pluginTitle ?? buttonConfig.name;
    item.appendChild(name);

    item.addEventListener("click", () => handleButtonPress(item, buttonConfig));
    gridContainer.appendChild(item);
  }

  const dots = document.getElementById("page-dots");
  if (dots) dots.remove();

  const indicator = document.getElementById("page-indicator");
  if (indicator) indicator.textContent = "";
}

function renderView() {
  if (viewMode === "list") {
    renderList();
  } else {
    renderGrid();
  }
}

let isAnimating = false;

function createAdjacentPage(direction) {
  const savedPage = currentPage;
  currentPage += direction === "next" ? 1 : -1;

  const totalCells = config.grid.rows * config.grid.cols;
  const startIndex = currentPage * totalCells;
  const buttonsToShow = config.buttons?.slice(startIndex, startIndex + totalCells) || [];

  const el = document.createElement("div");
  el.className = "grid-container";
  el.style.gridTemplateRows = `repeat(${config.grid.rows}, 1fr)`;
  el.style.gridTemplateColumns = `repeat(${config.grid.cols}, 1fr)`;
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.zIndex = "4";
  el.style.pointerEvents = "none";
  el.style.willChange = "transform";
  el.style.transition = "none";
  el.style.transform = `translateX(${direction === "next" ? "100%" : "-100%"})`;

  for (let i = 0; i < totalCells; i++) {
    const bc = buttonsToShow[i];
    const btn = document.createElement("div");
    btn.className = "grid-button";
    if (bc) {
      const pluginImage = pluginRender.images?.[bc.context];
      const pluginTitle = pluginRender.titles?.[bc.context];

      if (pluginImage) {
        const img = document.createElement("img");
        img.src = pluginImage;
        img.className = "button-plugin-img";
        img.alt = "";
        btn.appendChild(img);
      } else {
        btn.appendChild(createIcon(bc.icon, 24, 'currentColor', 1.7));
      }
      const label = document.createElement("span");
      label.className = "button-label";
      label.textContent = pluginTitle ?? bc.name;
      btn.appendChild(label);
    }
    el.appendChild(btn);
  }

  currentPage = savedPage;
  return el;
}

function navigatePage(direction) {
  if (isAnimating) return;
  const totalCells = config.grid.rows * config.grid.cols;
  const totalPages = Math.ceil((config.buttons?.length || 0) / totalCells);
  if (direction === "next" && currentPage >= totalPages - 1) return;
  if (direction === "prev" && currentPage <= 0) return;

  isAnimating = true;
  const container = document.getElementById("grid-container");

  const outgoing = container.cloneNode(true);
  outgoing.removeAttribute("id");
  outgoing.style.position = "fixed";
  outgoing.style.inset = "0";
  outgoing.style.zIndex = "5";
  outgoing.style.pointerEvents = "none";
  outgoing.style.willChange = "transform";
  document.body.appendChild(outgoing);

  currentPage += direction === "next" ? 1 : -1;
  renderView();

  const enterFrom = direction === "next" ? "100%" : "-100%";
  const exitTo = direction === "next" ? "-100%" : "100%";
  const easing = "cubic-bezier(0.4, 0, 0.2, 1)";
  const duration = "0.3s";

  container.style.transform = `translateX(${enterFrom})`;
  container.style.transition = "none";
  container.style.willChange = "transform";

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      outgoing.style.transition = `transform ${duration} ${easing}`;
      outgoing.style.transform = `translateX(${exitTo})`;
      container.style.transition = `transform ${duration} ${easing}`;
      container.style.transform = "translateX(0)";

      outgoing.addEventListener("transitionend", () => {
        outgoing.remove();
        container.style.transition = "";
        container.style.transform = "";
        container.style.willChange = "";
        isAnimating = false;
      }, { once: true });
    });
  });
}

function updatePageIndicator() {
  const totalCells = config.grid.rows * config.grid.cols;
  const totalPages = Math.ceil((config.buttons?.length || 0) / totalCells);
  const indicator = document.getElementById("page-indicator");
  if (indicator) {
    indicator.textContent = totalPages > 1
      ? `${currentPage + 1}/${totalPages}`
      : "";
  }

  let dots = document.getElementById("page-dots");
  if (totalPages <= 1) {
    if (dots) dots.remove();
    return;
  }
  if (!dots) {
    dots = document.createElement("div");
    dots.id = "page-dots";
    dots.className = "page-dots";
    document.body.appendChild(dots);
  }
  dots.innerHTML = "";
  for (let i = 0; i < totalPages; i++) {
    const dot = document.createElement("div");
    dot.className = "page-dot" + (i === currentPage ? " active" : "");
    dots.appendChild(dot);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Set theme from localStorage or default to dark
  const savedTheme = localStorage.getItem('pc.theme');
  if (savedTheme === 'light') {
    document.body.classList.remove('dark-mode');
  } else {
    document.body.classList.add('dark-mode');
  }

  try {
    config = await api.getConfig();
  } catch (err) {
    console.error("Failed to load config:", err);
    document.getElementById("grid-container").innerHTML =
      '<div class="error-state"><div><strong>Connection failed</strong><span>Is the backend running?</span><button class="retry-load-btn" onclick="location.reload()">Retry</button></div></div>';
    return;
  }

  await fetchPluginRender();
  renderPanelHeader();
  renderView();
  startHealthPing();
  startAutocompleteSSE();

  if (typeof window.__TAURI__ !== "undefined") {
    const closeBtn = document.getElementById("tauri-close");
    if (closeBtn) {
      closeBtn.classList.remove("hidden");
      closeBtn.addEventListener("click", () => window.close());
    }
  }

  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeActive = false;
  let swipeDir = null;
  let swipeSibling = null;
  let swipeLastX = 0;
  let swipeLastTime = 0;
  let swipeVelocity = 0;
  const gridContainer = document.getElementById("grid-container");

  gridContainer.addEventListener("touchstart", (e) => {
    if (viewMode !== "grid" || isAnimating) return;
    swipeStartX = swipeLastX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeLastTime = e.timeStamp;
    swipeActive = false;
    swipeDir = null;
    swipeSibling = null;
    swipeVelocity = 0;
  }, { passive: true });

  gridContainer.addEventListener("touchmove", (e) => {
    if (viewMode !== "grid" || isAnimating) return;

    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;
    const dt = e.timeStamp - swipeLastTime;
    if (dt > 0) swipeVelocity = (e.touches[0].clientX - swipeLastX) / dt;
    swipeLastX = e.touches[0].clientX;
    swipeLastTime = e.timeStamp;

    if (!swipeActive) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) return;

      const totalCells = config.grid.rows * config.grid.cols;
      const totalPages = Math.ceil((config.buttons?.length || 0) / totalCells);
      const dir = dx < 0 ? "next" : "prev";
      if (dir === "next" && currentPage >= totalPages - 1) return;
      if (dir === "prev" && currentPage <= 0) return;

      swipeDir = dir;
      swipeSibling = createAdjacentPage(dir);
      document.body.appendChild(swipeSibling);
      gridContainer.style.transition = "none";
      gridContainer.style.willChange = "transform";
      swipeActive = true;
    }

    if (!swipeActive) return;
    e.preventDefault();

    gridContainer.style.transform = `translateX(${dx}px)`;
    const vw = window.innerWidth;
    swipeSibling.style.transform = `translateX(${(swipeDir === "next" ? vw : -vw) + dx}px)`;
  }, { passive: false });

  gridContainer.addEventListener("touchend", (e) => {
    if (!swipeActive) return;
    swipeActive = false;

    const dx = e.changedTouches[0].clientX - swipeStartX;
    const vw = window.innerWidth;
    const easing = "cubic-bezier(0.4, 0, 0.2, 1)";
    const dur = "0.24s";
    const shouldCommit = Math.abs(dx) > vw * 0.35 || Math.abs(swipeVelocity) > 0.4;

    if (shouldCommit) {
      isAnimating = true;
      currentPage += swipeDir === "next" ? 1 : -1;
      updatePageIndicator();

      const exitTo = `${swipeDir === "next" ? -vw : vw}px`;
      gridContainer.style.transition = `transform ${dur} ${easing}`;
      gridContainer.style.transform = `translateX(${exitTo})`;
      swipeSibling.style.transition = `transform ${dur} ${easing}`;
      swipeSibling.style.transform = "translateX(0)";

      const sib = swipeSibling;
      swipeSibling = null;
      sib.addEventListener("transitionend", () => {
        sib.remove();
        renderView();
        gridContainer.style.transition = "";
        gridContainer.style.transform = "";
        gridContainer.style.willChange = "";
        isAnimating = false;
      }, { once: true });
    } else {
      const snapBack = `${swipeDir === "next" ? vw : -vw}px`;
      gridContainer.style.transition = `transform ${dur} ease`;
      gridContainer.style.transform = "translateX(0)";
      swipeSibling.style.transition = `transform ${dur} ease`;
      swipeSibling.style.transform = `translateX(${snapBack})`;

      const sib = swipeSibling;
      swipeSibling = null;
      gridContainer.addEventListener("transitionend", () => {
        sib.remove();
        gridContainer.style.transition = "";
        gridContainer.style.transform = "";
        gridContainer.style.willChange = "";
        swipeDir = null;
      }, { once: true });
    }
  }, { passive: true });

});
