import { api } from './api.js';
import { showToast } from './toast.js';
import { el } from './utils.js';
import { collectSettings } from './settings.js';
import { updateModelInfo } from './models.js';
import type { StartServerResponse, StatusResponse } from './types.js';

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

  el.statusIndicator.querySelector('.status-dot')!.className = 'status-dot loading';
  el.statusIndicator.querySelector('.status-text')!.textContent = 'Starting...';
  el.startBtn.disabled = true;

  try {
    const data = await api<StartServerResponse>('/api/server/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath }),
    });
    if (data.success) {
      showToast('Server started', 'success');
      updateModelInfo();
    } else {
      showToast(data.error || 'Failed to start', 'error');
    }
  } catch (e) {
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
      el.startBtn.disabled = true;
      el.stopBtn.disabled = false;
      el.sendBtn.disabled = false;
      if (welcomeSubtitle && welcomeSubtitle.textContent?.includes('start the server')) {
        welcomeSubtitle.textContent = 'Select a model and enter a message below to begin chatting.';
      }
    } else {
      dot.className = 'status-dot';
      txt.textContent = 'Disconnected';
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
    if (dot) dot.className = 'status-dot';
    if (txt) txt.textContent = 'Error';
    el.startBtn.disabled = false;
    el.stopBtn.disabled = true;
    el.sendBtn.disabled = true;
  }
}
