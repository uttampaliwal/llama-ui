import { showToast } from './toast.js';

const THEMES = ['dark', 'light', 'oled', 'dracula', 'nord', 'catppuccin', 'gruvbox'] as const;
export type Theme = typeof THEMES[number];

const STORAGE_KEY = 'theme';

function getSavedTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && THEMES.includes(saved as Theme)) {
    return saved as Theme;
  }
  return 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);

  // Update active state in UI
  const options = document.querySelectorAll('.theme-option');
  options.forEach((opt) => {
    const el = opt as HTMLElement;
    el.classList.toggle('active', el.dataset.theme === theme);
  });
}

export function initTheme(): void {
  const theme = getSavedTheme();
  applyTheme(theme);

  // Listen for theme clicks
  const grid = document.getElementById('themeGrid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.theme-option');
      if (!target) return;
      const theme = (target as HTMLElement).dataset.theme as Theme;
      if (theme && THEMES.includes(theme)) {
        applyTheme(theme);
        showToast(`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`, 'success');
      }
    });
  }
}

export function getTheme(): Theme {
  return getSavedTheme();
}
