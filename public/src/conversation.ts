import { el, showWelcome, downloadFile } from './utils.js';
import { showToast } from './toast.js';
import { extractThinking, formatMd, escapeHtml } from './markdown.js';
import { renderMath } from './latex.js';
import { formatMessage } from './formatter.js';
import { textOf, type ChatMessage, type Conversation, type ContentPart, type ExportFormat } from './types.js';
import {
  getAllConversations,
  putConversations,
  deleteConversationById,
} from './db.js';
import { clearPendingAttachments } from './attachments.js';
import { logError } from './logger.js';
import { AppState, setCurrentConvId } from './state.js';

let loadPromise: Promise<void> | null = null;

export function loadConversations(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const stored = await getAllConversations();
        if (stored && stored.length) {
          AppState.conversations.list = stored;
          return;
        }
      } catch (e) {
        console.warn('IndexedDB load failed:', e);
      }
      // One-time migration from legacy localStorage store
      try {
        const raw = localStorage.getItem('conversations');
        if (raw) {
          const v = JSON.parse(raw);
          const arr: Conversation[] = Array.isArray(v)
            ? (v as Conversation[])
            : v && typeof v === 'object'
              ? (Object.values(v) as Conversation[])
              : [];
          AppState.conversations.list = arr;
          localStorage.removeItem('conversations');
          await putConversations(arr);
        }
      } catch (e) {
        console.warn('Migration from localStorage failed:', e);
      }
    })();
  }
  return loadPromise;
}

export function getCurrentConv(): Conversation | null {
  const { list, currentId } = AppState.conversations;
  if (!Array.isArray(list)) return null;
  return list.find((c) => c.id === currentId) || null;
}

export { setCurrentConvId } from './state.js';

export async function saveConversations(): Promise<void> {
  try {
    await putConversations(AppState.conversations.list);
  } catch (e) {
    console.warn('Failed to persist conversations:', e);
  }
}

export function getConversations(): Conversation[] {
  return Array.isArray(AppState.conversations.list) ? AppState.conversations.list : [];
}

// ---------------------------------------------------------------------------
// Virtual (windowed) chat rendering
//
// Only the messages near the current scroll position are kept in the DOM. The
// space they would occupy above/below the viewport is represented by spacer
// divs sized from cached (or estimated) message heights, so long conversations
// stay cheap to scroll. Messages already mounted are reused by id so in-flight
// state (e.g. streaming) is preserved.
// ---------------------------------------------------------------------------
const OVERSCAN = 800; // px rendered beyond the viewport on each side
const heights = new Map<string, number>();
const nodeForId = new Map<string, HTMLElement>();
let lastStart = -1;
let lastEnd = -1;
let rafPending = 0;
let virtualReady = false;

function textLength(content: ChatMessage['content']): number {
  if (typeof content === 'string') return content.length;
  return content.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 600), 0);
}

function estimateHeight(msg: ChatMessage): number {
  if (msg.role === 'assistant' && !msg.content) return 120;
  const len = textLength(msg.content);
  return Math.max(80, Math.min(1400, len / 1.6 + 80));
}

function heightFor(msg: ChatMessage): number {
  const h = heights.get(msg.id);
  return h && h > 0 ? h : estimateHeight(msg);
}

function convMessages(): ChatMessage[] {
  const conv = getCurrentConv();
  return conv ? conv.messages : [];
}

function fillContent(
  contentDiv: HTMLElement,
  thinking: string,
  text: string,
  ts: number | string | undefined,
  id: string,
): void {
  formatMessage(thinking, text, ts)
    .then((html) => {
      contentDiv.innerHTML = html;
      renderMath(contentDiv);
      heights.set(id, contentDiv.offsetHeight);
      scheduleWindowUpdate();
    })
    .catch((e) => {
      logError('fillContent', e);
      contentDiv.innerHTML = escapeHtml(text);
      renderMath(contentDiv);
    });
}

function userContentHtml(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => {
      if (p.type === 'text') return p.text;
      if (p.type === 'image_url') {
        return `<img src="${p.image_url.url}" class="user-attached-img" alt="attachment">`;
      }
      return '';
    })
    .join('<br>');
}

const SVG_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const SVG_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const SVG_REGEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
const SVG_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const SVG_SHARE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';

function userActionsHtml(): string {
  return `
    <button class="action-btn copy-message-btn" title="Copy" aria-label="Copy message">${SVG_COPY}</button>
    <button class="action-btn edit-message-btn" title="Edit" aria-label="Edit message">${SVG_EDIT}</button>
    <div class="action-divider"></div>
    <button class="action-btn delete-message-btn danger" title="Delete" aria-label="Delete message">${SVG_DELETE}</button>
  `;
}

function assistantActionsHtml(): string {
  return `
    <button class="action-btn copy-message-btn" title="Copy" aria-label="Copy message">${SVG_COPY}</button>
    <button class="action-btn regenerate-btn" title="Regenerate" aria-label="Regenerate response">${SVG_REGEN}</button>
    <div class="action-divider"></div>
    <button class="action-btn share-message-btn" title="Share" aria-label="Share message">${SVG_SHARE}</button>
    <button class="action-btn delete-message-btn danger" title="Delete" aria-label="Delete message">${SVG_DELETE}</button>
  `;
}

function buildMessageNode(msg: ChatMessage, streaming: boolean): HTMLElement {
  const div = document.createElement('div');
  div.className = `message ${msg.role}`;
  div.dataset.messageId = msg.id;
  div.setAttribute('role', 'article');
  div.setAttribute('aria-label', `${msg.role === 'user' ? 'Your message' : 'Assistant response'}`);
  const thinking = msg.thinking || '';

  if (msg.role === 'user') {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = userContentHtml(msg.content);
    div.appendChild(contentDiv);
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', 'Message actions');
    actions.innerHTML = userActionsHtml();
    div.appendChild(actions);
    requestAnimationFrame(() => renderMath(contentDiv));
    return div;
  }

  if (streaming && !msg.content) {
    div.innerHTML = `<div class="message-content"><div class="thinking-container" style="display:none"><details class="thinking-block"><summary>Thinking...</summary><div class="thinking-content"></div></details></div><div class="response-container" aria-live="polite"></div></div><div class="message-actions" role="group" aria-label="Message actions">${assistantActionsHtml()}</div>`;
    return div;
  }

  const { thinking: t, content: c } = extractThinking(msg.content as string);
  const th = t || thinking;
  const text = c || (msg.content as string);
  div.innerHTML = `<div class="message-content"></div><div class="message-actions" role="group" aria-label="Message actions">${assistantActionsHtml()}</div>`;
  const contentDiv = div.querySelector('.message-content') as HTMLElement;
  fillContent(contentDiv, th, text, msg.createdAt, msg.id);
  return div;
}

function measureMounted(): void {
  for (const [id, node] of nodeForId) {
    const h = node.offsetHeight;
    if (h > 0) heights.set(id, h);
  }
}

function mountWindow(): void {
  try {
    const msgs = convMessages();
    const n = msgs.length;
    if (n === 0) {
      if (el.chatMessages.childElementCount > 0) el.chatMessages.innerHTML = '';
      nodeForId.clear();
      lastStart = lastEnd = -1;
      return;
    }
    const clientH = el.chatMessages.clientHeight || 600;
    const scrollTop = el.chatMessages.scrollTop;
    const offsets = new Array<number>(n);
    let offset = 0;
    for (let i = 0; i < n; i++) {
      offsets[i] = offset;
      offset += heightFor(msgs[i]);
    }
    const total = offset;
    const viewBottom = scrollTop + clientH;
    let start = 0;
    while (start < n - 1 && offsets[start + 1] < scrollTop - OVERSCAN) start++;
    let end = start;
    while (end < n - 1 && offsets[end + 1] < viewBottom + OVERSCAN) end++;

    if (start === lastStart && end === lastEnd) return;
    lastStart = start;
    lastEnd = end;

    const inWindow = new Set<string>();
    for (let i = start; i <= end; i++) inWindow.add(msgs[i].id);
    for (const [id, node] of nodeForId) {
      if (!inWindow.has(id)) {
        node.remove();
        nodeForId.delete(id);
      }
    }

    el.chatMessages.innerHTML = '';
    const top = document.createElement('div');
    top.className = 'vspacer';
    top.style.height = offsets[start] + 'px';
    el.chatMessages.appendChild(top);
    for (let i = start; i <= end; i++) {
      const msg = msgs[i];
      let node = nodeForId.get(msg.id);
      if (!node) {
        node = buildMessageNode(msg, false);
        nodeForId.set(msg.id, node);
      }
      el.chatMessages.appendChild(node);
    }
    const bottom = document.createElement('div');
    bottom.className = 'vspacer';
    bottom.style.height = Math.max(0, total - offsets[end + 1]) + 'px';
    el.chatMessages.appendChild(bottom);

    requestAnimationFrame(measureMounted);
  } catch (e) {
    console.warn('Virtual scroll failed, falling back to full render:', e);
    fallbackRenderAll();
  }
}

function fallbackRenderAll(): void {
  const msgs = convMessages();
  el.chatMessages.innerHTML = '';
  nodeForId.clear();
  for (const msg of msgs) {
    const node = buildMessageNode(msg, false);
    nodeForId.set(msg.id, node);
    el.chatMessages.appendChild(node);
  }
  lastStart = lastEnd = -1;
}

function scheduleWindowUpdate(): void {
  if (rafPending) return;
  rafPending = requestAnimationFrame(() => {
    rafPending = 0;
    mountWindow();
  });
}

export function setupVirtualScroll(): void {
  if (virtualReady) return;
  virtualReady = true;
  el.chatMessages.addEventListener('scroll', scheduleWindowUpdate, { passive: true });
  window.addEventListener('resize', scheduleWindowUpdate);
}

export function clearChatView(): void {
  nodeForId.clear();
  el.chatMessages.innerHTML = '';
  lastStart = lastEnd = -1;
}

export function newConversation(): Conversation {
  const conv: Conversation = {
    id: Date.now().toString(),
    title: 'New Conversation',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  AppState.conversations.list.unshift(conv);
  setCurrentConvId(conv.id);
  saveConversations();
  clearChatView();
  clearPendingAttachments();
  el.chatTitle.textContent = 'New Conversation';
  el.sendBtn.classList.remove('regenerate-mode');
  el.sendBtn.querySelector('.btn-icon')!.textContent = '➤';
  el.sendBtn.querySelector('.btn-label')!.textContent = 'Send';
  el.userInput.value = '';
  el.restartBtn.classList.add('hidden');
  return conv;
}

export function selectConversation(id: string): void {
  const conv = AppState.conversations.list.find((c) => c.id === id);
  if (!conv) return;
  setCurrentConvId(id);
  el.sendBtn.classList.remove('regenerate-mode');
  el.sendBtn.querySelector('.btn-icon')!.textContent = '➤';
  el.sendBtn.querySelector('.btn-label')!.textContent = 'Send';
  el.restartBtn.classList.add('hidden');
  saveConversations();
  renderConversation(conv);
}

export function renderConversation(conv: Conversation): void {
  el.chatTitle.textContent = conv.title;
  clearChatView();
  mountWindow();
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  mountWindow();
}

export function renderMessage(msg: ChatMessage, scroll = true, streaming = false): void {
  let node = nodeForId.get(msg.id);
  if (!node) {
    node = buildMessageNode(msg, streaming);
    nodeForId.set(msg.id, node);
  } else if (streaming) {
    const fresh = buildMessageNode(msg, true);
    node.replaceWith(fresh);
    nodeForId.set(msg.id, fresh);
    node = fresh;
  }
  mountWindow();
  if (scroll) {
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
    mountWindow();
  }
}

export function updateStreamingContent(
  msgId: string,
  fullContent: string,
  thinkingText?: string,
  responseText?: string,
): void {
  const msgEl = el.chatMessages.querySelector(`.message[data-message-id="${msgId}"]`);
  if (!msgEl) return;
  const thinkingContainer = msgEl.querySelector('.thinking-container') as HTMLElement | null;
  const responseContainer = msgEl.querySelector('.response-container') as HTMLElement | null;
  if (!thinkingContainer && !responseContainer) {
    updateMessageContent(msgId, fullContent);
    return;
  }
  if (thinkingText && thinkingContainer) {
    thinkingContainer.style.display = '';
    const tc = thinkingContainer.querySelector('.thinking-content');
    if (tc) tc.textContent = thinkingText;
  }
  if (responseContainer && responseText) {
    responseContainer.innerHTML = formatMd(responseText);
  }
}

export function updateMessageContent(msgId: string, content: string): void {
  const msgEl = el.chatMessages.querySelector(`.message[data-message-id="${msgId}"]`);
  if (!msgEl) return;
  const contentDiv = msgEl.querySelector('.message-content') as HTMLElement | null;
  if (contentDiv) {
    const msg = AppState.conversations.list.flatMap((c) => c.messages).find((m) => m.id === msgId);
    const thinking = msg?.thinking ?? '';
    const { thinking: t, content: c } = extractThinking(content);
    const th = t || thinking;
    fillContent(contentDiv, th, c || content, msg?.createdAt, msgId);
  }
}

export function generateTitle(conv: Conversation): string {
  const firstMsg = conv.messages.find((m) => m.role === 'user');
  if (!firstMsg) return 'New Conversation';
  const txt = textOf(firstMsg.content).replace(/<[^>]*>/g, '').trim();
  return txt.length > 40 ? txt.substring(0, 40) + '...' : txt;
}

export function renameConversation(id: string): void {
  const conv = AppState.conversations.list.find((c) => c.id === id);
  if (!conv) return;
  const newTitle = prompt('Conversation name:', conv.title);
  if (newTitle && newTitle.trim()) {
    conv.title = newTitle.trim();
    conv.updatedAt = new Date().toISOString();
    saveConversations();
    import('./sidebar.js').then((m) => m.renderSidebar());
    if (AppState.conversations.currentId === id) el.chatTitle.textContent = conv.title;
  }
}

export function deleteConversation(id: string): void {
  if (!confirm('Delete this conversation?')) return;
  AppState.conversations.list = AppState.conversations.list.filter((c) => c.id !== id);
  if (AppState.conversations.currentId === id) {
    setCurrentConvId(null);
    clearChatView();
    showWelcome();
    el.restartBtn.classList.add('hidden');
  }
  deleteConversationById(id);
  import('./sidebar.js').then((m) => m.renderSidebar());
}

export function exportConversation(format: ExportFormat): void {
  const conv = getCurrentConv();
  if (!conv) return showToast('No conversation to export', 'error');

  if (format === 'markdown') {
    let md = `# ${conv.title}\n\n`;
    conv.messages.forEach((m) => {
      md += `### ${m.role === 'user' ? 'You' : 'Assistant'}\n\n`;
      const plain = textOf(m.content).replace(/<[^>]*>/g, '');
      md += plain + '\n\n';
    });
    downloadFile(md, `${conv.title.replace(/[^a-z0-9]/gi, '_')}.md`, 'text/markdown');
  } else if (format === 'json') {
    downloadFile(JSON.stringify(conv, null, 2), `${conv.title.replace(/[^a-z0-9]/gi, '_')}.json`, 'application/json');
  }
}

// ---- Conversation metadata helpers ------------------------------------------

export function togglePin(id: string): void {
  const conv = AppState.conversations.list.find((c) => c.id === id);
  if (!conv) return;
  conv.pinned = !conv.pinned;
  saveConversations();
  import('./sidebar.js').then((m) => m.renderSidebar());
}

export function toggleStar(id: string): void {
  const conv = AppState.conversations.list.find((c) => c.id === id);
  if (!conv) return;
  conv.starred = !conv.starred;
  saveConversations();
  import('./sidebar.js').then((m) => m.renderSidebar());
}

export function archiveConversation(id: string): void {
  const conv = AppState.conversations.list.find((c) => c.id === id);
  if (!conv) return;
  conv.archived = true;
  if (AppState.conversations.currentId === id) {
    setCurrentConvId(null);
    clearChatView();
    showWelcome();
    el.restartBtn.classList.add('hidden');
  }
  saveConversations();
  import('./sidebar.js').then((m) => m.renderSidebar());
}

export function unarchiveConversation(id: string): void {
  const conv = AppState.conversations.list.find((c) => c.id === id);
  if (!conv) return;
  conv.archived = false;
  saveConversations();
  import('./sidebar.js').then((m) => m.renderSidebar());
}

export function moveToFolder(id: string, folderId: string | null): void {
  const conv = AppState.conversations.list.find((c) => c.id === id);
  if (!conv) return;
  conv.folderId = folderId || undefined;
  saveConversations();
  import('./sidebar.js').then((m) => m.renderSidebar());
}

export function batchDelete(ids: string[]): void {
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} conversation(s)?`)) return;
  const idSet = new Set(ids);
  AppState.conversations.list = AppState.conversations.list.filter((c) => !idSet.has(c.id));
  if (idSet.has(AppState.conversations.currentId || '')) {
    setCurrentConvId(null);
    clearChatView();
    showWelcome();
    el.restartBtn.classList.add('hidden');
  }
  for (const id of ids) deleteConversationById(id);
  AppState.ui.selectedIds.clear();
  AppState.ui.multiSelectMode = false;
  import('./sidebar.js').then((m) => m.renderSidebar());
}

export function batchExport(ids: string[], format: ExportFormat): void {
  const convs = AppState.conversations.list.filter((c) => ids.includes(c.id));
  if (!convs.length) return;
  if (format === 'markdown') {
    let md = '';
    for (const conv of convs) {
      md += `# ${conv.title}\n\n`;
      conv.messages.forEach((m) => {
        md += `### ${m.role === 'user' ? 'You' : 'Assistant'}\n\n`;
        md += textOf(m.content).replace(/<[^>]*>/g, '') + '\n\n';
      });
      md += '---\n\n';
    }
    downloadFile(md, 'conversations.md', 'text/markdown');
  } else {
    downloadFile(JSON.stringify(convs, null, 2), 'conversations.json', 'application/json');
  }
}
