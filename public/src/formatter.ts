import { buildMessageHtml } from './markdown.js';

let worker: Worker | null | undefined;
const pending = new Map<number, (html: string) => void>();
const cache = new Map<string, string>();
let nextId = 1;

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

/**
 * Render a message's HTML (markdown + syntax highlighting) off the main thread.
 * Falls back to synchronous rendering if the worker is unavailable.
 */
export function formatMessage(
  thinking: string,
  answer: string,
  timestamp?: number | string,
  thinkingDuration?: number,
): Promise<string> {
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
    // Safety net: if the worker never replies, render on the main thread.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        done(buildMessageHtml(thinking, answer, timestamp, undefined, thinkingDuration));
      }
    }, 2000);
    w.postMessage({ id, thinking, answer, timestamp, thinkingDuration });
  });
}
