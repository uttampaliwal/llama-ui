import { showToast } from './toast.js';
import { el, $, esc } from './utils.js';
import { logError } from './logger.js';
import { AppState } from './state.js';
import type { Attachment, AttachKind } from './types.js';

export type { AttachKind, Attachment };

export function clearPendingAttachments(): void {
  AppState.attachments = [];
  renderAttachmentList();
}

const CODE_EXT = new Set([
  'py', 'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'html', 'htm', 'css', 'scss',
  'json', 'xml', 'yaml', 'yml', 'md', 'markdown', 'sh', 'bash', 'zsh', 'c',
  'cpp', 'h', 'hpp', 'java', 'go', 'rs', 'rb', 'php', 'sql', 'log', 'toml',
  'ini', 'cfg', 'kt', 'swift', 'r', 'pl', 'ps1',
]);

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function computeMaxChars(): number {
  const ctx = parseInt($<HTMLInputElement>('contextSize').value) || 4096;
  return Math.floor(ctx * 3.5 * 0.7);
}

function kindOf(file: File): AttachKind {
  const name = file.name.toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  const t = file.type;
  if (t.startsWith('image/')) return 'image';
  if (t === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (ext === 'zip') return 'zip';
  if (CODE_EXT.has(ext)) return 'code';
  return 'text';
}

// ---- Lazy library loading ---------------------------------------------------

const libPromises = new Map<string, Promise<any>>();

function loadLibOnce(src: string, globalName: string): Promise<any> {
  const w = window as unknown as Record<string, any>;
  if (w[globalName]) return Promise.resolve(w[globalName]);
  const cached = libPromises.get(globalName);
  if (cached) return cached;
  const p = new Promise<any>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(w[globalName]);
    s.onerror = () => reject(new Error('Failed to load ' + globalName));
    document.head.appendChild(s);
  });
  libPromises.set(globalName, p);
  return p;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return {
    text: text.slice(0, max) + '\n\n[File truncated to ' + max + ' characters]',
    truncated: true,
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Format-specific text extraction ----------------------------------------

async function extractPdf(file: File): Promise<string> {
  const pdfjsLib = await loadLibOnce('/vendor/libs/pdf.min.js', 'pdfjsLib');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/libs/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  const pages = Math.min(doc.numPages, 60);
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    text += tc.items.map((it: any) => it.str ?? '').join(' ') + '\n';
  }
  return text;
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await loadLibOnce('/vendor/libs/mammoth.min.js', 'mammoth');
  const ab = await file.arrayBuffer();
  const res = await mammoth.convertToHtml({ arrayBuffer: ab });
  return htmlToText(res.value);
}

async function extractXlsx(file: File): Promise<string> {
  const XLSX = await loadLibOnce('/vendor/libs/xlsx.full.min.js', 'XLSX');
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  let text = '';
  for (const sn of wb.SheetNames) {
    text += `\n### Sheet: ${sn}\n`;
    text += XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
  }
  return text;
}

async function extractZip(file: File): Promise<{ text: string; entries: { name: string; size: number }[] }> {
  const JSZip = await loadLibOnce('/vendor/libs/jszip.min.js', 'JSZip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const textExt = /\.(txt|md|markdown|csv|tsv|json|xml|html|htm|yaml|yml|py|js|ts|jsx|tsx|java|c|cpp|h|hpp|go|rs|rb|php|sql|log|toml|ini|cfg|sh|bat|ps1?)$/i;
  const entries: { name: string; size: number }[] = [];
  let text = '';
  for (const [name, f] of Object.entries(zip.files)) {
    const entry = f as unknown as {
      dir: boolean;
      _data?: { uncompressedSize?: number };
      async(format: string): Promise<string>;
    };
    const size = entry._data?.uncompressedSize ?? 0;
    entries.push({ name, size });
    if (!entry.dir && textExt.test(name) && size < 200000) {
      try {
        text += `\n--- ${name} ---\n` + (await entry.async('string'));
      } catch {
        /* skip unreadable entry */
      }
    }
  }
  return { text, entries: entries.slice(0, 300) };
}

// ---- Preview HTML -----------------------------------------------------------

function kindIcon(kind: AttachKind): string {
  switch (kind) {
    case 'image': return '🖼️';
    case 'pdf': return '📕';
    case 'docx': return '📘';
    case 'xlsx': return '📗';
    case 'csv': return '📊';
    case 'zip': return '🗜️';
    case 'code': return '💻';
    default: return '📄';
  }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function csvPreview(text: string): string {
  const rows = text.split(/\r?\n/).filter((r) => r.trim().length);
  const head = rows.slice(0, 12);
  let html = '<table class="attach-csv"><tbody>';
  for (const r of head) {
    const cells = splitCsvLine(r).slice(0, 8);
    html += '<tr>' + cells.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>';
  }
  html += '</tbody></table>';
  if (rows.length > 12) html += `<div class="attach-note">+ ${rows.length - 12} more rows</div>`;
  return html;
}

function codePreview(name: string, text: string): string {
  const hl = (window as unknown as { hljs?: any }).hljs;
  const lang = (name.split('.').pop() || '').toLowerCase();
  let body: string;
  if (hl && hl.getLanguage && hl.getLanguage(lang)) {
    try { body = hl.highlight(text.slice(0, 4000), { language: lang }).value; } catch { body = esc(text.slice(0, 4000)); }
  } else {
    body = esc(text.slice(0, 4000));
  }
  return `<pre class="attach-code"><code class="hljs language-${lang}">${body}</code></pre>`;
}

function snippetPreview(title: string, meta: string, text: string): string {
  const snippet = text.slice(0, 1200);
  return `<div class="attach-note">${esc(title)}${meta ? ' · ' + esc(meta) : ''}</div><pre class="attach-code"><code>${esc(snippet)}</code></pre>`;
}

function zipPreview(entries: { name: string; size: number }[]): string {
  const fmt = (n: number) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  let html = '<div class="attach-zip">';
  for (const e of entries.slice(0, 40)) {
    html += `<div class="attach-zip-row"><span>${esc(e.name)}</span><span class="attach-meta">${fmt(e.size)}</span></div>`;
  }
  if (entries.length > 40) html += `<div class="attach-note">+ ${entries.length - 40} more entries</div>`;
  html += '</div>';
  return html;
}

// ---- Parsing pipeline -------------------------------------------------------

export async function parseFile(file: File): Promise<Attachment> {
  const kind = kindOf(file);
  const base: Attachment = { id: uid(), name: file.name, mime: file.type, kind };
  const max = computeMaxChars();
  try {
    switch (kind) {
      case 'image': {
        const dataUrl = await readAsDataURL(file);
        return { ...base, dataUrl };
      }
      case 'code':
      case 'text': {
        const raw = await readAsText(file);
        const { text, truncated } = truncate(raw, max);
        return { ...base, text, truncated, previewHtml: codePreview(file.name, raw) };
      }
      case 'csv': {
        const raw = await readAsText(file);
        const { text, truncated } = truncate(raw, max);
        return { ...base, text, truncated, previewHtml: csvPreview(raw) };
      }
      case 'pdf': {
        const raw = await extractPdf(file);
        const { text, truncated } = truncate(raw, max);
        return { ...base, text, truncated, previewHtml: snippetPreview('PDF', '', raw) };
      }
      case 'docx': {
        const raw = await extractDocx(file);
        const { text, truncated } = truncate(raw, max);
        return { ...base, text, truncated, previewHtml: snippetPreview('DOCX', '', raw) };
      }
      case 'xlsx': {
        const raw = await extractXlsx(file);
        const { text, truncated } = truncate(raw, max);
        return { ...base, text, truncated, previewHtml: snippetPreview('Excel', '', raw) };
      }
      case 'zip': {
        const { text, entries } = await extractZip(file);
        const { text: t2, truncated } = truncate(text, max);
        return { ...base, text: t2, truncated, previewHtml: zipPreview(entries) };
      }
    }
  } catch (e) {
    return { ...base, error: 'Could not parse file' };
  }
  return { ...base, error: 'Unsupported file type' };
}

// ---- Preview list -----------------------------------------------------------

export function renderAttachmentList(): void {
  const list = $('attachmentList');
  if (!list) return;
  if (!AppState.attachments.length) {
    el.attachmentPreview.style.display = 'none';
    list.innerHTML = '';
    el.attachBtn.classList.remove('has-attachment');
    return;
  }
  el.attachmentPreview.style.display = 'flex';
  el.attachBtn.classList.add('has-attachment');
  list.innerHTML = '';
  for (const a of AppState.attachments) {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    const meta = a.error
      ? `<span class="attach-error">⚠ ${esc(a.error)}</span>`
      : a.text
        ? `${(a.text.length / 1000).toFixed(1)}k chars${a.truncated ? ' (truncated)' : ''}`
        : a.dataUrl
          ? 'image'
          : '';
    chip.innerHTML =
      `<div class="attach-head"><span class="attach-icon">${kindIcon(a.kind)}</span>` +
      `<span class="attach-fname" title="${esc(a.name)}">${esc(a.name)}</span>` +
      `<span class="attach-meta">${meta}</span>` +
      `<button class="icon-btn attach-remove" title="Remove">✕</button></div>`;
    if (a.previewHtml) {
      const pv = document.createElement('div');
      pv.className = 'attach-body';
      pv.innerHTML = a.previewHtml;
      chip.appendChild(pv);
    } else if (a.dataUrl) {
      const img = document.createElement('img');
      img.src = a.dataUrl;
      img.className = 'attach-img';
      chip.appendChild(img);
    }
    chip.querySelector('.attach-remove')!.addEventListener('click', () => removeAttachment(a.id));
    list.appendChild(chip);
  }
}

function removeAttachment(id: string): void {
  AppState.attachments = AppState.attachments.filter((a) => a.id !== id);
  renderAttachmentList();
}

function checkVision(): void {
  if (!AppState.attachments.some((a) => a.kind === 'image')) return;
  const m = AppState.models[el.modelSelect.value];
  const caps = m && m.capabilities ? m.capabilities : [];
  if (!caps.includes('vision')) {
    showToast('Warning: current model does not support vision', 'error');
  }
}

export function setupAttachmentListeners(): void {
  $('attachBtn').addEventListener('click', () => $<HTMLInputElement>('fileInput').click());

  $<HTMLInputElement>('fileInput').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || !files.length) return;
    const tasks: Promise<void>[] = [];
    for (const file of Array.from(files)) {
      tasks.push(
        parseFile(file)
          .then((att) => {
            AppState.attachments.push(att);
          })
          .catch((e) => logError('parseFile', e, { name: file.name })),
      );
    }
    Promise.all(tasks).then(() => {
      renderAttachmentList();
      checkVision();
      el.userInput.focus();
    });
    input.value = '';
  });
}
