import { el, esc, closeSidebar } from './utils.js';
import {
  getConversations,
  setCurrentConvId,
  selectConversation,
  renameConversation,
  deleteConversation,
  newConversation,
} from './conversation.js';
import { textOf, type Conversation, type ChatMessage } from './types.js';

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

function firstMatchSnippet(conv: Conversation, term: string): string | null {
  for (const m of conv.messages) {
    const raw = textOf(m.content);
    const idx = raw.toLowerCase().indexOf(term);
    if (idx !== -1) {
      const start = Math.max(0, idx - 32);
      const end = Math.min(raw.length, idx + term.length + 60);
      let snip = raw.slice(start, end).replace(/\s+/g, ' ').trim();
      if (start > 0) snip = '…' + snip;
      if (end < raw.length) snip = snip + '…';
      return snip;
    }
  }
  return null;
}

export function renderSidebar(): void {
  el.sidebarList.innerHTML = '';
  const convs = getConversations();
  const searchTerm = (el.sidebarSearch?.value || '').toLowerCase().trim();

  let filtered: Conversation[] = convs;
  if (searchTerm) {
    filtered = convs.filter(
      (c) =>
        c.title.toLowerCase().includes(searchTerm) ||
        c.messages.some((m: ChatMessage) => textOf(m.content).toLowerCase().includes(searchTerm)),
    );
  }

  filtered.forEach((conv) => {
    const div = document.createElement('div');
    div.className = 'conversation-item';
    div.setAttribute('role', 'option');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-label', `${conv.title}, ${conv.messages.length} messages, ${new Date(conv.updatedAt || conv.createdAt).toLocaleDateString()}`);
    const date = new Date(conv.updatedAt || conv.createdAt);
    const dateStr = date.toLocaleDateString();
    const snippet =
      searchTerm && !conv.title.toLowerCase().includes(searchTerm)
        ? firstMatchSnippet(conv, searchTerm)
        : null;
    div.innerHTML = `
      <div class="conv-title" title="${esc(conv.title)}" role="button" tabindex="0">${esc(conv.title)}</div>
      ${snippet ? `<div class="conv-snippet" aria-label="Matching content: ${esc(snippet)}">${esc(snippet)}</div>` : ''}
      <div class="conv-meta">
        <span class="conv-date">${dateStr}</span>
        <span class="conv-msg-count">${conv.messages.length} msgs</span>
      </div>
      <div class="conv-actions" role="group" aria-label="Conversation actions">
        <span class="conv-action rename-action" title="Rename" role="button" tabindex="0" aria-label="Rename conversation">✏️</span>
        <span class="conv-action delete-action" title="Delete" role="button" tabindex="0" aria-label="Delete conversation">🗑️</span>
      </div>
    `;
    div.querySelector('.conv-title')!.addEventListener('click', () => {
      setCurrentConvId(conv.id);
      selectConversation(conv.id);
      closeSidebar();
    });
    div.querySelector('.conv-title')!.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        e.preventDefault();
        setCurrentConvId(conv.id);
        selectConversation(conv.id);
        closeSidebar();
      }
    });
    div.querySelector('.rename-action')!.addEventListener('click', (e) => {
      e.stopPropagation();
      renameConversation(conv.id);
    });
    div.querySelector('.rename-action')!.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        renameConversation(conv.id);
      }
    });
    div.querySelector('.delete-action')!.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });
    div.querySelector('.delete-action')!.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        deleteConversation(conv.id);
      }
    });
    div.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        e.preventDefault();
        setCurrentConvId(conv.id);
        selectConversation(conv.id);
        closeSidebar();
      }
    });
    el.sidebarList.appendChild(div);
  });
}

export function setupSidebarListeners(): void {
  el.sidebarSearch?.addEventListener('input', () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(renderSidebar, 150);
  });

  el.newChatBtn.addEventListener('click', () => {
    newConversation();
    closeSidebar();
  });
}
