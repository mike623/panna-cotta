class StreamDeckAPI {
  constructor() {
    const backendHost = window.location.host;
    this.baseUrl = `http://${backendHost}`;
    this.wsUrl = `ws://${backendHost}`;
    this.ws = new WebSocket(`${this.wsUrl}/ws`);
    this.setupEventHandlers();
  }

  async getConfig() {
    const response = await fetch(`${this.baseUrl}/api/config`);
    return response.json();
  }
  
  async executeAction(action, target) {
    const response = await fetch(`http://localhost:8000/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, target })
    });
    return response.json();
  }
  
  async getSystemStatus() {
    const response = await fetch(`http://localhost:8000/api/system-status`);
    return response.json();
  }

  setupEventHandlers() {
    // WebSocket event handlers will be set up here
  }
}

const api = new StreamDeckAPI();
let currentPage = 0;
let config;

async function renderGrid() {
  const gridContainer = document.getElementById('grid-container');
  gridContainer.innerHTML = ''; // Clear existing grid

  gridContainer.style.gridTemplateRows = `repeat(${config.grid.rows}, 1fr)`;
  gridContainer.style.gridTemplateColumns = `repeat(${config.grid.cols}, 1fr)`;

  const totalCells = config.grid.rows * config.grid.cols;
  const startIndex = currentPage * totalCells;
  const endIndex = startIndex + totalCells;
  const buttonsToShow = config.buttons?.slice(startIndex, endIndex) || [];

  for (let i = 0; i < totalCells; i++) {
    const buttonConfig = buttonsToShow[i];
    const button = document.createElement('div');
    button.className = 'bg-gray-800 rounded-lg flex items-center justify-center';

    if (buttonConfig) {
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', buttonConfig.icon);
      icon.className = 'text-white';
      button.appendChild(icon);

      button.addEventListener('click', () => {
        if (buttonConfig.type === 'browser') {
          window.open(buttonConfig.action, '_blank');
        } else if (buttonConfig.type === 'system') {
          api.executeAction('open-app', buttonConfig.action);
        }
      });
    }

    gridContainer.appendChild(button);
  }
  lucide.createIcons();
}

document.addEventListener("DOMContentLoaded", async () => {
  config = await api.getConfig();
  await renderGrid();

  const toggleThemeButton = document.getElementById('toggle-theme');
  const prevPageButton = document.getElementById('prev-page');
  const nextPageButton = document.getElementById('next-page');
  const collapseToolbarButton = document.getElementById('collapse-toolbar');
  const expandToolbarButton = document.getElementById('expand-toolbar');
  const mainToolbar = document.getElementById('main-toolbar');

  toggleThemeButton.addEventListener('click', () => {
    document.body.classList.toggle('bg-black');
    document.body.classList.toggle('bg-white');
    const icon = toggleThemeButton.querySelector('i');
    const isDarkMode = document.body.classList.contains('bg-black');
    icon.setAttribute('data-lucide', isDarkMode ? 'sun' : 'moon');
    lucide.createIcons();
  });

  prevPageButton.addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage--;
      renderGrid();
    }
  });

  nextPageButton.addEventListener('click', () => {
    const totalCells = config.grid.rows * config.grid.cols;
    const totalPages = Math.ceil((config.buttons?.length || 0) / totalCells);
    if (currentPage < totalPages - 1) {
      currentPage++;
      renderGrid();
    }
  });

  collapseToolbarButton.addEventListener('click', () => {
    mainToolbar.classList.add('hidden');
    expandToolbarButton.classList.remove('hidden');
  });

  expandToolbarButton.addEventListener('click', () => {
    mainToolbar.classList.remove('hidden');
    expandToolbarButton.classList.add('hidden');
  });
});
