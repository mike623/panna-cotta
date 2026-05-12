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

const HEALTH_PING_INTERVAL = 5000;
const HEALTH_BACKOFF_MAX = 60000;
const HEALTH_MAX_FAILURES = 6;
let healthTimeoutId = null;
let healthFailCount = 0;

function getOrCreateBanner() {
  let banner = document.getElementById("connection-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "connection-banner";
    banner.className = "connection-banner hidden";
    document.body.prepend(banner);
  }
  return banner;
}

function updateBanner(state, secondsLeft) {
  const banner = getOrCreateBanner();
  if (state === "online") {
    banner.classList.add("hidden");
    connectionLost = false;
    return;
  }
  connectionLost = true;
  if (state === "retrying") {
    banner.innerHTML = `<i data-lucide="wifi-off"></i><span>Backend disconnected — retrying in ${secondsLeft}s</span>`;
  } else {
    banner.innerHTML = '<i data-lucide="wifi-off"></i><span>Backend disconnected</span><button class="banner-retry-btn">Retry</button>';
    banner.querySelector(".banner-retry-btn").addEventListener("click", manualHealthRetry);
  }
  banner.classList.remove("hidden");
  lucide.createIcons({ nodes: [banner] });
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
        const icon = document.createElement("i");
        icon.setAttribute("data-lucide", buttonConfig.icon);
        icon.className = "button-icon";
        button.appendChild(icon);
      }

      const label = document.createElement("span");
      label.className = "button-label";
      label.textContent = pluginTitle ?? buttonConfig.name;
      button.appendChild(label);

      button.addEventListener("click", () => handleButtonPress(button, buttonConfig));
    }

    gridContainer.appendChild(button);
  }

  lucide.createIcons();
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
      const icon = document.createElement("i");
      icon.setAttribute("data-lucide", buttonConfig.icon);
      icon.className = "list-item-icon";
      item.appendChild(icon);
    }

    const name = document.createElement("span");
    name.className = "list-item-name";
    name.textContent = pluginTitle ?? buttonConfig.name;
    item.appendChild(name);

    item.addEventListener("click", () => handleButtonPress(item, buttonConfig));
    gridContainer.appendChild(item);
  }

  lucide.createIcons();

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
        const icon = document.createElement("i");
        icon.setAttribute("data-lucide", bc.icon);
        icon.className = "button-icon";
        btn.appendChild(icon);
      }
      const label = document.createElement("span");
      label.className = "button-label";
      label.textContent = pluginTitle ?? bc.name;
      btn.appendChild(label);
    }
    el.appendChild(btn);
  }

  currentPage = savedPage;
  lucide.createIcons({ nodes: [el] });
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
  const savedTheme = localStorage.getItem("theme") || "dark";
  document.body.className = savedTheme === "dark" ? "dark-mode" : "light-mode";

  try {
    config = await api.getConfig();
  } catch (err) {
    console.error("Failed to load config:", err);
    document.getElementById("grid-container").innerHTML =
      '<div class="error-state"><div><strong>Connection failed</strong><span>Is the backend running?</span><button class="retry-load-btn" onclick="location.reload()">Retry</button></div></div>';
    return;
  }

  await fetchPluginRender();
  renderView();
  startHealthPing();

  if (typeof window.__TAURI__ !== "undefined") {
    const closeBtn = document.getElementById("tauri-close");
    if (closeBtn) {
      closeBtn.classList.remove("hidden");
      lucide.createIcons({ nodes: [closeBtn] });
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
