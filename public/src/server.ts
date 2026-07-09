import { api } from './api.js';
import { showToast } from './toast.js';
import { el } from './utils.js';
import { collectSettings } from './settings.js';
import type { StartServerResponse, StatusResponse } from './types.js';
import { startStatusUpdates, stopStatusUpdates } from './status.js';

const loadingDots = document.querySelector('.loading-dots') as HTMLElement;
const loadingProgress = document.getElementById('loadingProgress');
const loadingProgressBar = document.getElementById('loadingProgressBar');

let switching = false;

export function isSwitching(): boolean { return switching; }

function setLoadingState(loading: boolean, text?: string): void {
  const dot = el.statusIndicator.querySelector('.status-dot')!;
  const txt = el.statusIndicator.querySelector('.status-text')!;
  if (loading) {
    dot.className = 'status-dot loading';
    txt.textContent = text || 'Starting...';
    loadingDots.style.display = '';
    el.stopBtn.disabled = true;
  } else {
    loadingDots.style.display = 'none';
    if (loadingProgress) loadingProgress.style.display = 'none';
  }
}

function showProgress(pct: number): void {
  if (!loadingProgress || !loadingProgressBar) return;
  loadingProgress.style.display = '';
  loadingProgressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  loadingProgress.setAttribute('aria-valuenow', String(Math.round(pct)));
}

export async function ensureServerRunning(modelPath: string): Promise<boolean> {
  if (!modelPath) return false;

  switching = true;
  console.log('[UI] ensureServerRunning:', modelPath);

  // Check if already running with this model
  try {
    const status = await api<StatusResponse>('/api/status');
    console.log('[UI] Status check:', status);
    if (status.running && status.currentModel === modelPath) {
      console.log('[UI] Already running with same model, skip');
      switching = false;
      return true;
    }
  } catch (e) {
    console.log('[UI] Status check failed:', e);
  }

  // Post settings first
  const s = collectSettings();
  if (s) {
    await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
  }

  setLoadingState(true, 'Loading model...');
  showProgress(10);

  let progress = 10;
  const progressInterval = setInterval(() => {
    if (progress < 90) {
      progress += Math.random() * 15;
      if (progress > 90) progress = 90;
      showProgress(progress);
    }
  }, 500);

  try {
    const data = await api<StartServerResponse>('/api/server/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath }),
    });
    clearInterval(progressInterval);
    console.log('[UI] Start response:', data);

    if (data.success) {
      showProgress(100);
      setLoadingState(false);
      showToast('Model loaded', 'success');
      (await import('./models.js')).updateModelInfo();
      startStatusUpdates();
      await checkStatus();
      switching = false;
      return true;
    } else {
      setLoadingState(false);
      showToast(data.error || 'Failed to load model', 'error');
      await checkStatus();
      switching = false;
      return false;
    }
  } catch (e) {
    clearInterval(progressInterval);
    setLoadingState(false);
    const msg = (e as Error).message || 'Failed to load model';
    console.log('[UI] Start failed:', msg, e);
    showToast(msg, 'error');
    await checkStatus();
    switching = false;
    return false;
  }
}

export async function stopServer(): Promise<void> {
  switching = true;
  try {
    await api('/api/server/stop', { method: 'POST' });
    showToast('Server stopped', 'success');
    stopStatusUpdates();
  } catch (e) {
    showToast('Failed to stop', 'error');
  }
  await checkStatus();
  switching = false;
}

export async function checkStatus(): Promise<void> {
  if (switching) return;
  try {
    const data = await api<StatusResponse>('/api/status');
    const dot = el.statusIndicator.querySelector('.status-dot')!;
    const txt = el.statusIndicator.querySelector('.status-text')!;
    const welcomeSubtitle = el.welcomeScreen ? el.welcomeScreen.querySelector('p') : null;

    if (data.running) {
      dot.className = 'status-dot connected';
      txt.textContent = 'Connected';
      loadingDots.style.display = 'none';
      el.stopBtn.disabled = false;
      el.sendBtn.disabled = false;
      if (welcomeSubtitle && welcomeSubtitle.textContent?.includes('start the server')) {
        welcomeSubtitle.textContent = 'Select a model and enter a message below to begin chatting.';
      }
    } else {
      dot.className = 'status-dot';
      txt.textContent = 'Disconnected';
      loadingDots.style.display = 'none';
      el.stopBtn.disabled = true;
      el.sendBtn.disabled = true;
      if (welcomeSubtitle) {
        welcomeSubtitle.textContent = 'Select a model to start chatting.';
      }
    }
  } catch (e) {
    const dot = el.statusIndicator.querySelector('.status-dot');
    const txt = el.statusIndicator.querySelector('.status-text');
    if (dot) dot.className = 'status-dot error';
    if (txt) txt.textContent = 'Error';
    loadingDots.style.display = 'none';
    el.stopBtn.disabled = true;
    el.sendBtn.disabled = true;
  }
}
