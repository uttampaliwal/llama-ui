import { buildMessageHtml } from './markdown.js';
import { logError } from './logger.js';

let worker: Worker | null | undefined;
const pending = new Map<number, (html: string) => void>();
const cache = new Map<string, string>();
let nextId = 1;

let highlightInited = false;
function ensureHighlight(): void {
  if (highlightInited) return;
  highlightInited = true;

  // Inject highlight theme CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/vendor/highlight/styles/github-dark.min.css';
  document.head.appendChild(link);

  // Warm up highlight.js on the main thread (for fallback)
  // @ts-ignore — runtime URL path resolved by the static server
  import('/vendor/highlight/highlight.esm.js')
    .then((m) => {
      (window as any).hljs = m.default;
    })
    .catch((e) => logError('highlight', e));
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker ?? null;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { id, html } = e.data as { id: number; html: string };
      const cb = pending.get(id);
      if (cb) {
        pending.delete(id);
        cb(html);
      }
    };
    worker.onerror = () => {
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker ?? null;
}

export function formatMessage(
  thinking: string,
  answer: string,
  timestamp?: number | string,
  thinkingDuration?: number,
): Promise<string> {
  ensureHighlight();

  const key = `${thinking} ${answer} ${timestamp ?? ''} ${thinkingDuration ?? ''}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  const w = getWorker();
  if (!w) return Promise.resolve(buildMessageHtml(thinking, answer, timestamp, undefined, thinkingDuration));

  return new Promise<string>((resolve) => {
    const id = nextId++;
    let settled = false;
    const done = (html: string) => {
      if (settled) return;
      settled = true;
      cache.set(key, html);
      resolve(html);
    };
    pending.set(id, done);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        done(buildMessageHtml(thinking, answer, timestamp, undefined, thinkingDuration));
      }
    }, 2000);
    w.postMessage({ id, thinking, answer, timestamp, thinkingDuration });
  });
}
