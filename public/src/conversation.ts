import { el, showWelcome, downloadFile } from './utils.js';
import { showToast } from './toast.js';
import { buildMessageHtml, extractThinking, formatMd } from './markdown.js';
import { renderMath, highlightCodeBlocks } from './latex.js';
import { textOf, type ChatMessage, type Conversation, type ExportFormat } from './types.js';
import {
  getAllConversations,
  putConversations,
  deleteConversationById,
} from './db.js';

let conversations: Conversation[] = [];
let currentConversationId: string | null = localStorage.getItem('currentConversationId') || null;

let loadPromise: Promise<void> | null = null;

export function loadConversations(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const stored = await getAllConversations();
        if (stored && stored.length) {
          conversations = stored;
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
          conversations = arr;
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
  if (!Array.isArray(conversations)) return null;
  return conversations.find((c) => c.id === currentConversationId) || null;
}

export function setCurrentConvId(id: string | null): void {
  currentConversationId = id;
  if (id) localStorage.setItem('currentConversationId', id);
  else localStorage.removeItem('currentConversationId');
}

export async function saveConversations(): Promise<void> {
  try {
    await putConversations(conversations);
  } catch (e) {
    console.warn('Failed to persist conversations:', e);
  }
}

export function getConversations(): Conversation[] {
  return Array.isArray(conversations) ? conversations : [];
}

export function newConversation(): Conversation {
  const conv: Conversation = {
    id: Date.now().toString(),
    title: 'New Conversation',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  conversations.unshift(conv);
  currentConversationId = conv.id;
  saveConversations();
  el.chatMessages.innerHTML = '';
  el.chatTitle.textContent = 'New Conversation';
  el.sendBtn.classList.remove('regenerate-mode');
  el.sendBtn.querySelector('.btn-icon')!.textContent = '➤';
  el.sendBtn.querySelector('.btn-label')!.textContent = 'Send';
  el.userInput.value = '';
  el.restartBtn.classList.add('hidden');
  return conv;
}

export function selectConversation(id: string): void {
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return;
  currentConversationId = id;
  el.sendBtn.classList.remove('regenerate-mode');
  el.sendBtn.querySelector('.btn-icon')!.textContent = '➤';
  el.sendBtn.querySelector('.btn-label')!.textContent = 'Send';
  el.restartBtn.classList.add('hidden');
  saveConversations();
  renderConversation(conv);
}

export function renderConversation(conv: Conversation): void {
  el.chatMessages.innerHTML = '';
  el.chatTitle.textContent = conv.title;
  conv.messages.forEach((msg) => renderMessage(msg, false));
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

export function renderMessage(msg: ChatMessage, scroll = true, streaming = false): void {
  const div = document.createElement('div');
  div.className = `message ${msg.role}`;
  div.dataset.messageId = msg.id;
  const thinking = msg.thinking || '';

  if (msg.role === 'user') {
    div.innerHTML = `<div class="message-content">${msg.content}</div><div class="message-actions"><span class="edit-message-btn" title="Edit">✏️</span><span class="delete-message-btn" title="Delete">🗑️</span></div>`;
  } else if (streaming && !msg.content) {
    div.innerHTML = `<div class="message-content"><div class="thinking-container" style="display:none"><details class="thinking-block"><summary>Thinking...</summary><div class="thinking-content"></div></details></div><div class="response-container"></div></div><div class="message-actions"><span class="copy-message-btn" title="Copy">📋</span><span class="regenerate-btn" title="Regenerate">🔄</span><span class="delete-message-btn" title="Delete">🗑️</span></div>`;
  } else {
    const { thinking: t, content: c } = extractThinking(msg.content as string);
    const th = t || thinking;
    div.innerHTML = `<div class="message-content">${buildMessageHtml(th, c || (msg.content as string), msg.createdAt)}</div><div class="message-actions"><span class="copy-message-btn" title="Copy">📋</span><span class="regenerate-btn" title="Regenerate">🔄</span><span class="delete-message-btn" title="Delete">🗑️</span></div>`;
  }
  el.chatMessages.appendChild(div);
  requestAnimationFrame(() => {
    const contentDiv = div.querySelector('.message-content');
    if (contentDiv) {
      renderMath(contentDiv);
      highlightCodeBlocks();
    }
  });
  if (scroll) el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
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
    const msg = conversations.flatMap((c) => c.messages).find((m) => m.id === msgId);
    const thinking = msg?.thinking ?? '';
    const { thinking: t, content: c } = extractThinking(content);
    const th = t || thinking;
    contentDiv.innerHTML = buildMessageHtml(th, c || content, msg?.createdAt);
    renderMath(contentDiv);
    highlightCodeBlocks();
  }
}

export function generateTitle(conv: Conversation): string {
  const firstMsg = conv.messages.find((m) => m.role === 'user');
  if (!firstMsg) return 'New Conversation';
  const txt = textOf(firstMsg.content).replace(/<[^>]*>/g, '').trim();
  return txt.length > 40 ? txt.substring(0, 40) + '...' : txt;
}

export function renameConversation(id: string): void {
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return;
  const newTitle = prompt('Conversation name:', conv.title);
  if (newTitle && newTitle.trim()) {
    conv.title = newTitle.trim();
    conv.updatedAt = new Date().toISOString();
    saveConversations();
    import('./sidebar.js').then((m) => m.renderSidebar());
    if (currentConversationId === id) el.chatTitle.textContent = conv.title;
  }
}

export function deleteConversation(id: string): void {
  if (!confirm('Delete this conversation?')) return;
  conversations = conversations.filter((c) => c.id !== id);
  if (currentConversationId === id) {
    currentConversationId = null;
    localStorage.removeItem('currentConversationId');
    el.chatMessages.innerHTML = '';
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
