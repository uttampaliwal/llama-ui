import { api } from './api.js';
import { showToast } from './toast.js';
import { el, $ } from './utils.js';
import { updateModelInfo } from './models.js';
import type { Settings, Preset } from './types.js';
import { getPresets, savePreset as putPreset, deletePresetByName } from './db.js';
import { logError } from './logger.js';

export async function loadSettings(): Promise<void> {
  try {
    const s = await api<Settings>('/api/settings');
    $<HTMLInputElement>('temperature').value = String(s.temperature);
    $<HTMLSpanElement>('temperatureVal').textContent = String(s.temperature);
    $<HTMLInputElement>('topP').value = String(s.topP);
    $<HTMLSpanElement>('topPVal').textContent = String(s.topP);
    $<HTMLInputElement>('topK').value = String(s.topK);
    $<HTMLSpanElement>('topKVal').textContent = String(s.topK);
    $<HTMLInputElement>('maxTokens').value = String(s.maxTokens);
    $<HTMLInputElement>('contextSize').value = String(s.contextSize);
    $<HTMLInputElement>('gpuLayers').value = String(s.gpuLayers);
    $<HTMLInputElement>('threads').value = String(s.threads);
    $<HTMLInputElement>('repeatPenalty').value = String(s.repeatPenalty);
    $<HTMLSpanElement>('repeatPenaltyVal').textContent = String(s.repeatPenalty);
    el.systemPrompt.value = s.systemPrompt;
    updateModelInfo();
  } catch (e) {
    logError('loadSettings', e);
  }
}

export function collectSettings(): Settings | null {
  const s: Settings = {
    temperature: parseFloat($<HTMLInputElement>('temperature').value),
    topP: parseFloat($<HTMLInputElement>('topP').value),
    topK: parseInt($<HTMLInputElement>('topK').value),
    maxTokens: parseInt($<HTMLInputElement>('maxTokens').value),
    contextSize: parseInt($<HTMLInputElement>('contextSize').value),
    gpuLayers: parseInt($<HTMLInputElement>('gpuLayers').value),
    threads: parseInt($<HTMLInputElement>('threads').value),
    repeatPenalty: parseFloat($<HTMLInputElement>('repeatPenalty').value),
    systemPrompt: el.systemPrompt.value,
  };
  if ([s.temperature, s.topP, s.topK, s.maxTokens, s.contextSize, s.gpuLayers, s.threads, s.repeatPenalty].some((v) => Number.isNaN(v))) {
    showToast('Please enter valid numbers in all parameters', 'error');
    return null;
  }
  if (s.contextSize < s.maxTokens) {
    showToast('Context Size should be >= Max Tokens', 'error');
    return null;
  }
  return s;
}

export async function applySettings(): Promise<void> {
  const s = collectSettings();
  if (!s) return;
  const btn = el.applySettings;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Saving...';
  try {
    const res = await api<{ error?: string }>('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    if (res.error) throw new Error(res.error);
    updateModelInfo();
    showToast('Settings saved. Select a model to apply changes.', 'success');
  } catch (e) {
    showToast((e as Error).message || 'Failed to save settings', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

export async function renderPresets(): Promise<void> {
  const presets = await getPresets();
  const sel = el.presetSelect;
  sel.innerHTML = '<option value="">Select preset...</option>';
  Object.keys(presets).forEach((name) => {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  });
}

export async function applyPreset(name: string): Promise<void> {
  const presets = await getPresets();
  const p = presets[name];
  if (!p) return;
  $<HTMLInputElement>('temperature').value = String(p.temperature ?? '');
  $<HTMLSpanElement>('temperatureVal').textContent = String(p.temperature ?? '');
  $<HTMLInputElement>('topP').value = String(p.topP ?? '');
  $<HTMLSpanElement>('topPVal').textContent = String(p.topP ?? '');
  $<HTMLInputElement>('topK').value = String(p.topK ?? '');
  $<HTMLSpanElement>('topKVal').textContent = String(p.topK ?? '');
  $<HTMLInputElement>('maxTokens').value = String(p.maxTokens ?? '');
  $<HTMLInputElement>('contextSize').value = String(p.contextSize ?? '');
  $<HTMLInputElement>('gpuLayers').value = String(p.gpuLayers ?? '');
  $<HTMLInputElement>('threads').value = String(p.threads ?? '');
  $<HTMLInputElement>('repeatPenalty').value = String(p.repeatPenalty ?? '');
  $<HTMLSpanElement>('repeatPenaltyVal').textContent = String(p.repeatPenalty ?? '');
  el.systemPrompt.value = p.systemPrompt || '';
  showToast('Preset "' + name + '" applied', 'success');
}

export async function savePreset(): Promise<void> {
  const name = prompt('Preset name:');
  if (!name) return;
  const preset: Preset = {
    temperature: $<HTMLInputElement>('temperature').value,
    topP: $<HTMLInputElement>('topP').value,
    topK: $<HTMLInputElement>('topK').value,
    maxTokens: $<HTMLInputElement>('maxTokens').value,
    contextSize: $<HTMLInputElement>('contextSize').value,
    gpuLayers: $<HTMLInputElement>('gpuLayers').value,
    threads: $<HTMLInputElement>('threads').value,
    repeatPenalty: $<HTMLInputElement>('repeatPenalty').value,
    systemPrompt: el.systemPrompt.value,
  };
  await putPreset(name, preset);
  await renderPresets();
  showToast('Preset "' + name + '" saved', 'success');
}

export async function deletePreset(): Promise<void> {
  const sel = el.presetSelect;
  const name = sel.value;
  if (!name) return;
  if (!confirm('Delete preset "' + name + '"?')) return;
  await deletePresetByName(name);
  await renderPresets();
  showToast('Preset "' + name + '" deleted');
}

// Initialize settings navigation
export function initSettingsNav(): void {
  const navItems = document.querySelectorAll('.settings-nav-item');
  const categories = document.querySelectorAll('.settings-category');

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const category = (item as HTMLElement).dataset.category;

      // Update nav
      navItems.forEach((n) => n.classList.remove('active'));
      item.classList.add('active');

      // Update content
      categories.forEach((c) => {
        const cat = c as HTMLElement;
        if (cat.id.toLowerCase().includes(category || '')) {
          cat.style.display = 'block';
          cat.classList.add('active');
        } else {
          cat.style.display = 'none';
          cat.classList.remove('active');
        }
      });
    });
  });
}
