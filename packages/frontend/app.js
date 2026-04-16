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

  async executeAction(action, target) {
    const response = await fetch(`${this.baseUrl}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, target }),
    });
    if (!response.ok) throw new Error(`Execute failed: ${response.status}`);
    return response.json();
  }

  async openUrl(url) {
    const response = await fetch(`${this.baseUrl}/api/open-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) throw new Error(`Open URL failed: ${response.status}`);
    return response.json();
  }
}

const api = new StreamDeckAPI();
let currentPage = 0;
let config;

function flashButton(button, className) {
  button.classList.add(className);
  setTimeout(() => button.classList.remove(className), 600);
}

async function handleButtonPress(button, buttonConfig) {
  button.classList.add("button-loading");
  try {
    if (buttonConfig.type === "browser") {
      await api.openUrl(buttonConfig.action);
    } else if (buttonConfig.type === "system") {
      await api.executeAction("open-app", buttonConfig.action);
    }
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
      const icon = document.createElement("i");
      icon.setAttribute("data-lucide", buttonConfig.icon);
      icon.className = "button-icon";
      button.appendChild(icon);

      const label = document.createElement("span");
      label.className = "button-label";
      label.textContent = buttonConfig.name;
      button.appendChild(label);

      button.addEventListener(
        "click",
        () => handleButtonPress(button, buttonConfig),
      );
    }

    gridContainer.appendChild(button);
  }

  lucide.createIcons();
  updatePageIndicator();
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
}

document.addEventListener("DOMContentLoaded", async () => {
  const savedTheme = localStorage.getItem("theme") || "dark";
  document.body.className = savedTheme === "dark" ? "dark-mode" : "light-mode";

  try {
    config = await api.getConfig();
  } catch (err) {
    console.error("Failed to load config:", err);
    document.getElementById("grid-container").innerHTML =
      '<div class="error-state"><div><strong>Connection failed</strong>Is the backend running?</div></div>';
    return;
  }

  renderGrid();

  const toggleThemeButton = document.getElementById("toggle-theme");
  const prevPageButton = document.getElementById("prev-page");
  const nextPageButton = document.getElementById("next-page");
  const collapseToolbarButton = document.getElementById("collapse-toolbar");
  const expandToolbarButton = document.getElementById("expand-toolbar");
  const mainToolbar = document.getElementById("main-toolbar");

  const icon = toggleThemeButton.querySelector("i");
  icon.setAttribute("data-lucide", savedTheme === "dark" ? "sun" : "moon");
  lucide.createIcons();

  toggleThemeButton.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    document.body.classList.toggle("light-mode");
    const isDarkMode = document.body.classList.contains("dark-mode");
    localStorage.setItem("theme", isDarkMode ? "dark" : "light");
    const themeIcon = toggleThemeButton.querySelector("i");
    themeIcon.setAttribute("data-lucide", isDarkMode ? "sun" : "moon");
    lucide.createIcons();
  });

  prevPageButton.addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage--;
      renderGrid();
    }
  });

  nextPageButton.addEventListener("click", () => {
    const totalCells = config.grid.rows * config.grid.cols;
    const totalPages = Math.ceil((config.buttons?.length || 0) / totalCells);
    if (currentPage < totalPages - 1) {
      currentPage++;
      renderGrid();
    }
  });

  collapseToolbarButton.addEventListener("click", () => {
    mainToolbar.classList.add("hidden");
    expandToolbarButton.classList.remove("hidden");
  });

  expandToolbarButton.addEventListener("click", () => {
    mainToolbar.classList.remove("hidden");
    expandToolbarButton.classList.add("hidden");
  });
});
