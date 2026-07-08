import { buildMessageHtml } from './markdown.js';

const HIGHLIGHT_URL = '../vendor/highlight/highlight.esm.js';

interface Hljs {
  getLanguage(name: string): unknown;
  highlight(code: string, options: { language: string }): { value: string };
}

let hljsPromise: Promise<Hljs> | null = null;
function getHljs(): Promise<Hljs> {
  if (!hljsPromise) {
    hljsPromise = import(HIGHLIGHT_URL).then((m) => (m as { default: Hljs }).default);
  }
  return hljsPromise;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

self.onmessage = async (e: MessageEvent) => {
  const { id, thinking, answer, timestamp, thinkingDuration } = e.data as {
    id: number;
    thinking: string;
    answer: string;
    timestamp?: number | string;
    thinkingDuration?: number;
  };

  let hl: Hljs | undefined;
  try {
    hl = await getHljs();
  } catch {
    hl = undefined;
  }

  const highlight = (code: string, lang: string): string => {
    if (!hl) return escapeHtml(code);
    try {
      const language = hl.getLanguage(lang) ? lang : 'plaintext';
      return hl.highlight(code, { language }).value;
    } catch {
      return escapeHtml(code);
    }
  };

  const html = buildMessageHtml(thinking, answer, timestamp, highlight, thinkingDuration);
  (self as unknown as { postMessage(message: unknown): void }).postMessage({ id, html });
};
