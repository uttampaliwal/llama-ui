import { $ } from './utils.js';
import { api } from './api.js';
import { logError } from './logger.js';

let cachedModel = '';
let cachedContextSize = 0;

export function setModelInfo(name: string, contextSize: number): void {
  cachedModel = name;
  cachedContextSize = contextSize;
  updateStatusBar();
}

export function updateTokensPerSecond(tps: number): void {
  const el = $('statusSpeed');
  if (el) {
    const span = el.querySelector('span');
    if (span) {
      span.textContent = `${tps.toFixed(1)} tok/s`;
      el.classList.toggle('active', tps > 0);
    }
  }
}

export function updateContextUsage(used: number, total: number): void {
  const el = $('statusContext');
  if (el) {
    const span = el.querySelector('span');
    if (span) {
      span.textContent = `Context: ${formatTokens(used)} / ${formatTokens(total)}`;
      const percent = total > 0 ? (used / total) * 100 : 0;
      el.classList.toggle('warning', percent > 80);
      el.classList.toggle('error', percent > 95);
    }
  }
}

function updateStatusBar(): void {
  // Update model
  const modelEl = $('statusModel');
  if (modelEl) {
    const span = modelEl.querySelector('span');
    if (span) {
      span.textContent = cachedModel || 'No model';
      modelEl.classList.toggle('active', !!cachedModel);
    }
  }

  // Update context
  const contextEl = $('statusContext');
  if (contextEl) {
    const span = contextEl.querySelector('span');
    if (span) {
      span.textContent = `Context: -- / ${formatTokens(cachedContextSize)}`;
    }
  }
}

async function fetchSystemStatus(): Promise<void> {
  try {
    // Try to get GPU and RAM info from the server
    const data = await api<{ gpu?: { used: number; total: number }; ram?: { used: number; total: number } }>('/api/system');
    
    if (data.gpu) {
      const gpuEl = $('statusGpu');
      if (gpuEl) {
        const span = gpuEl.querySelector('span');
        if (span) {
          span.textContent = `GPU: ${formatGB(data.gpu.used)} / ${formatGB(data.gpu.total)}`;
          const percent = data.gpu.total > 0 ? (data.gpu.used / data.gpu.total) * 100 : 0;
          gpuEl.classList.toggle('warning', percent > 80);
          gpuEl.classList.toggle('error', percent > 95);
        }
      }
    }

    if (data.ram) {
      const ramEl = $('statusRam');
      if (ramEl) {
        const span = ramEl.querySelector('span');
        if (span) {
          span.textContent = `RAM: ${formatGB(data.ram.used)} / ${formatGB(data.ram.total)}`;
          const percent = data.ram.total > 0 ? (data.ram.used / data.ram.total) * 100 : 0;
          ramEl.classList.toggle('warning', percent > 80);
          ramEl.classList.toggle('error', percent > 95);
        }
      }
    }
  } catch (e) {
    // Silently fail - server might not have system info endpoint
    logError('fetchSystemStatus', e);
  }
}

function formatGB(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + 'k';
  }
  return tokens.toString();
}

// Update system status periodically when server is running
let statusInterval: ReturnType<typeof setInterval> | null = null;

export function startStatusUpdates(): void {
  if (statusInterval) return;
  fetchSystemStatus();
  statusInterval = setInterval(fetchSystemStatus, 10000); // Update every 10 seconds
}

export function stopStatusUpdates(): void {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
}

// Initialize
export function initStatusBar(): void {
  updateStatusBar();
}
