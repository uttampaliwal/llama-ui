import { api } from './api.js';
import { showToast } from './toast.js';
import { el } from './utils.js';
import { collectSettings } from './settings.js';
import { updateModelInfo } from './models.js';
import type { StartServerResponse, StatusResponse } from './types.js';

const loadingDots = document.querySelector('.loading-dots') as HTMLElement;
const loadingProgress = document.getElementById('loadingProgress');
const loadingProgressBar = document.getElementById('loadingProgressBar');

function setLoadingState(loading: boolean, text?: string): void {
  const dot = el.statusIndicator.querySelector('.status-dot')!;
  const txt = el.statusIndicator.querySelector('.status-text')!;

  if (loading) {
    dot.className = 'status-dot loading';
    txt.textContent = text || 'Starting';
    loadingDots.style.display = 'inline-flex';
    el.startBtn.disabled = true;
  } else {
    loadingDots.style.display = 'none';
    hideProgress();
  }
}

function showProgress(percent: number): void {
  if (loadingProgress && loadingProgressBar) {
    loadingProgress.style.display = 'block';
    loadingProgressBar.style.width = `${percent}%`;
    loadingProgress.setAttribute('aria-valuenow', String(percent));
  }
}

function hideProgress(): void {
  if (loadingProgress && loadingProgressBar) {
    loadingProgress.style.display = 'none';
    loadingProgressBar.style.width = '0%';
  }
}

export async function startServer(): Promise<void> {
  const modelPath = el.modelSelect.value;
  if (!modelPath) return showToast('Select a model first', 'error');

  const s = collectSettings();
  if (!s) return;
  await api('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  });

  setLoadingState(true, 'Loading model');
  showProgress(10);

  // Simulate progress while waiting for server
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

    if (data.success) {
      showProgress(100);
      setTimeout(() => {
        setLoadingState(false);
        showToast('Server started', 'success');
        updateModelInfo();
      }, 300);
    } else {
      setLoadingState(false);
      showToast(data.error || 'Failed to start', 'error');
    }
  } catch (e) {
    clearInterval(progressInterval);
    setLoadingState(false);
    const msg = (e as Error).message || 'Failed to start server';
    showToast(msg, 'error');
  }
  await checkStatus();
}

export async function stopServer(): Promise<void> {
  try {
    await api('/api/server/stop', { method: 'POST' });
    showToast('Server stopped', 'success');
  } catch (e) {
    showToast('Failed to stop', 'error');
  }
  await checkStatus();
}

export async function checkStatus(): Promise<void> {
  try {
    const data = await api<StatusResponse>('/api/status');
    const dot = el.statusIndicator.querySelector('.status-dot')!;
    const txt = el.statusIndicator.querySelector('.status-text')!;
    const welcomeSubtitle = el.welcomeScreen ? el.welcomeScreen.querySelector('p') : null;

    if (data.running) {
      dot.className = 'status-dot connected';
      txt.textContent = 'Connected';
      loadingDots.style.display = 'none';
      el.startBtn.disabled = true;
      el.stopBtn.disabled = false;
      el.sendBtn.disabled = false;
      if (welcomeSubtitle && welcomeSubtitle.textContent?.includes('start the server')) {
        welcomeSubtitle.textContent = 'Select a model and enter a message below to begin chatting.';
      }
    } else {
      dot.className = 'status-dot';
      txt.textContent = 'Disconnected';
      loadingDots.style.display = 'none';
      el.startBtn.disabled = false;
      el.stopBtn.disabled = true;
      el.sendBtn.disabled = true;
      if (welcomeSubtitle) {
        welcomeSubtitle.textContent = 'Select a local model and start the server to initialize the session.';
      }
    }
  } catch (e) {
    const dot = el.statusIndicator.querySelector('.status-dot');
    const txt = el.statusIndicator.querySelector('.status-text');
    if (dot) dot.className = 'status-dot error';
    if (txt) txt.textContent = 'Error';
    loadingDots.style.display = 'none';
    el.startBtn.disabled = false;
    el.stopBtn.disabled = true;
    el.sendBtn.disabled = true;
  }
}
