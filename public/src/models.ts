import { api } from './api.js';
import { el, $ } from './utils.js';
import type { ModelInfo } from './types.js';
import { AppState } from './state.js';
import { logError } from './logger.js';

// ---- Helpers ----------------------------------------------------------------

function capClass(cap: string): string {
  const lower = cap.toLowerCase();
  if (lower.includes('vision')) return 'vision';
  if (lower.includes('tool') || lower.includes('function')) return 'tool';
  return '';
}

// ---- Render -----------------------------------------------------------------

export async function loadModels(): Promise<void> {
  const list = $('modelList') as HTMLElement;
  if (!list) return;

  try {
    const { models } = await api<{ models: ModelInfo[] }>('/api/models');
    AppState.models = {};

    // Populate hidden select for server.ts compatibility
    el.modelSelect.innerHTML = '<option value="">Select a model...</option>';

    if (!models.length) {
      list.innerHTML = '<div class="model-empty">No models found</div>';
      return;
    }

    list.innerHTML = '';
    const selectedPath = el.modelSelect?.value || '';

    models.forEach((m) => {
      AppState.models[m.path] = m;

      // Add option to hidden select
      const opt = document.createElement('option');
      opt.value = m.path;
      opt.textContent = m.name;
      el.modelSelect.appendChild(opt);

      const card = document.createElement('div');
      card.className = 'model-card';
      card.dataset.path = m.path;
      card.setAttribute('role', 'option');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${m.name}, ${m.sizeFormatted}`);

      if (m.path === selectedPath) card.classList.add('selected');

      // Capabilities badges
      const capsHtml = (m.capabilities || [])
        .map((c) => `<span class="model-cap-badge ${capClass(c)}">${esc(c)}</span>`)
        .join('');

      card.innerHTML = `
        <div class="model-card-top">
          <span class="model-status-dot available" aria-hidden="true"></span>
          <span class="model-card-name" title="${esc(m.name)}">${esc(m.name)}</span>
          <div class="model-card-check" aria-hidden="true"></div>
        </div>
        ${capsHtml ? `<div class="model-card-caps">${capsHtml}</div>` : ''}
        <div class="model-card-meta">
          <span class="model-meta-item model-card-size">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            ${esc(m.sizeFormatted)}
          </span>
          ${m.folder ? `<span class="model-meta-item" title="${esc(m.folder)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            ${esc(m.folder.split('/').pop() || m.folder)}
          </span>` : ''}
        </div>
      `;

      card.addEventListener('click', () => selectModel(m.path));
      card.addEventListener('keydown', (e: Event) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          selectModel(m.path);
        }
      });

      list.appendChild(card);
    });
  } catch (e) {
    logError('loadModels', e);
    list.innerHTML = '<div class="model-empty">Failed to load models</div>';
  }
}

function selectModel(path: string): void {
  // Update hidden select for compatibility with server.ts etc.
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

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
