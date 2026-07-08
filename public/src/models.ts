import { api } from './api.js';
import { showToast } from './toast.js';
import { el, $ } from './utils.js';
import type { ModelInfo } from './types.js';
import { AppState } from './state.js';

export async function loadModels(): Promise<void> {
  try {
    const { models } = await api<{ models: ModelInfo[] }>('/api/models');
    AppState.models = {};
    el.modelSelect.innerHTML = '<option value="">Select a model...</option>';
    models.forEach((m) => {
      AppState.models[m.path] = m;
      const o = document.createElement('option');
      o.value = m.path;
      const caps = m.capabilities && m.capabilities.length ? ` [${m.capabilities.join(', ')}]` : '';
      o.textContent = `${m.name} (${m.sizeFormatted})${caps}`;
      el.modelSelect.appendChild(o);
    });
  } catch (e) {
    showToast('Failed to load models', 'error');
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
}
