import { api } from './api.js';
import { el, $ } from './utils.js';
import { showToast } from './toast.js';
import type { ModelInfo } from './types.js';
import { AppState } from './state.js';
import { logError } from './logger.js';

// ---- Helpers ----------------------------------------------------------------

function capClass(cap: string): string {
  const lower = cap.toLowerCase();
  if (lower === 'vision') return 'cap-vision';
  if (lower === 'tools') return 'cap-tools';
  if (lower === 'embedding') return 'cap-embed';
  return 'cap-text';
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---- Public -----------------------------------------------------------------

export async function loadModels(): Promise<void> {
  const list = $('modelList') as HTMLElement;
  if (!list) return;
  list.innerHTML = '<div class="model-loading"><span class="loading-dots"><span></span><span></span><span></span></span></div>';

  try {
    const data = await api<{ models: ModelInfo[] }>('/api/models');
    const models = data.models || [];
    AppState.models = {};
    el.modelSelect.innerHTML = '';

    // Group by folder
    const groups = new Map<string, ModelInfo[]>();
    for (const m of models) {
      const folder = m.folder || 'Root';
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder)!.push(m);
      AppState.models[m.path] = m;

      const opt = document.createElement('option');
      opt.value = m.path;
      opt.textContent = m.name;
      el.modelSelect.appendChild(opt);
    }

    list.innerHTML = '';
    for (const [folder, items] of groups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'model-group';
      groupEl.innerHTML = `<div class="model-group-title">${esc(folder)}</div>`;

      for (const m of items) {
        const caps = m.capabilities && m.capabilities.length
          ? m.capabilities.map((c) => `<span class="model-cap-badge ${capClass(c)}">${esc(c)}</span>`).join('') : '';

        const card = document.createElement('div');
        card.className = 'model-card';
        card.dataset.path = m.path;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Load ${m.name}`);
        card.innerHTML = `
          <div class="model-card-header">
            <span class="model-card-name">${esc(m.name)}</span>
          </div>
          <div class="model-card-meta">
            <span class="model-card-size">${esc(m.sizeFormatted)}</span>
            ${caps ? `<span class="model-card-caps">${caps}</span>` : ''}
          </div>`;

        card.addEventListener('click', () => selectModel(m.path));
        card.addEventListener('keydown', (e: Event) => {
          if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
            e.preventDefault();
            selectModel(m.path);
          }
        });

        groupEl.appendChild(card);
      }
      list.appendChild(groupEl);
    }
  } catch (e) {
    logError('loadModels', e);
    list.innerHTML = '<div class="model-empty">Failed to load models</div>';
  }
}

async function selectModel(path: string): Promise<void> {
  // Update hidden select for compatibility
  el.modelSelect.value = path;

  // Update card UI
  const list = $('modelList') as HTMLElement;
  if (list) {
    list.querySelectorAll('.model-card').forEach((card) => {
      const c = card as HTMLElement;
      c.classList.toggle('selected', c.dataset.path === path);
    });
  }

  updateModelInfo();

  // Auto-start/restart server with this model
  try {
    const { ensureServerRunning } = await import('./server.js');
    await ensureServerRunning(path);
  } catch (e) {
    showToast('Failed to load model: ' + (e as Error).message, 'error');
  }
}

export function updateModelInfo(): void {
  const path = el.modelSelect.value;
  const m = AppState.models[path];
  if (!m) {
    el.modelInfo.textContent = '';
    el.modelBadge.textContent = '';
    return;
  }
  const ctx = parseInt($<HTMLInputElement>('contextSize').value) || '-';
  const gpu = parseInt($<HTMLInputElement>('gpuLayers').value) || '-';
  const thr = parseInt($<HTMLInputElement>('threads').value) || '-';
  const caps = m.capabilities && m.capabilities.length ? m.capabilities.join(', ') : 'text';
  el.modelInfo.textContent = `${m.name} · ${m.sizeFormatted} · ctx ${ctx} · GPU ${gpu} · ${thr}T`;
  el.modelBadge.textContent = `${m.name} · ${caps}`;

  // Update status bar
  const contextSize = parseInt($<HTMLInputElement>('contextSize').value) || 0;
  import('./status.js').then(mod => mod.setModelInfo(m.name, contextSize));
}
