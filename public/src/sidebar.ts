import { el, esc, closeSidebar } from './utils.js';
import {
  getConversations,
  setCurrentConvId,
  selectConversation,
  renameConversation,
  deleteConversation,
  newConversation,
  togglePin,
  toggleStar,
  archiveConversation,
  unarchiveConversation,
  moveToFolder,
  batchDelete,
  batchExport,
} from './conversation.js';
import { getAllFolders, putFolders, deleteFolderById } from './db.js';
import { textOf, type Conversation, type ChatMessage } from './types.js';
import { AppState } from './state.js';
import { logError } from './logger.js';

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
type ConvFilter = 'all' | 'pinned' | 'starred' | 'archived';
let currentFilter: ConvFilter = 'all';

// ---- Helpers ----------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.floor(hr / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7) return day + 'd ago';
  const week = Math.floor(day / 7);
  if (week < 4) return week + 'w ago';
  return new Date(dateStr).toLocaleDateString();
}

function lastMessageText(conv: Conversation): string {
  const last = conv.messages[conv.messages.length - 1];
  if (!last) return 'No messages yet';
  const raw = textOf(last.content);
  return raw.length > 180 ? raw.slice(0, 180) + '…' : raw;
}

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

// ---- Render -----------------------------------------------------------------

export function renderSidebar(): void {
  el.sidebarList.innerHTML = '';
  const convs = getConversations();
  const searchTerm = (el.sidebarSearch?.value || '').toLowerCase().trim();

  // Toggle multi-select class on list
  if (AppState.ui.multiSelectMode) {
    el.sidebarList.classList.add('multi-select-mode');
  } else {
    el.sidebarList.classList.remove('multi-select-mode');
  }

  // Load folders
  const folders = AppState.ui.folders;

  // Filter
  let filtered: Conversation[] = convs;
  if (searchTerm) {
    filtered = convs.filter(
      (c) =>
        c.title.toLowerCase().includes(searchTerm) ||
        c.messages.some((m: ChatMessage) => textOf(m.content).toLowerCase().includes(searchTerm)),
    );
  } else {
    switch (currentFilter) {
      case 'pinned': filtered = convs.filter((c) => c.pinned); break;
      case 'starred': filtered = convs.filter((c) => c.starred); break;
      case 'archived': filtered = convs.filter((c) => c.archived); break;
      default: filtered = convs.filter((c) => !c.archived); break;
    }
  }

  // Sort: pinned first, then by updatedAt desc
  filtered.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  // Group by folder
  const unfiled = filtered.filter((c) => !c.folderId || !folders.find((f) => f.id === c.folderId));
  const folderMap = new Map<string, Conversation[]>();
  for (const f of folders) folderMap.set(f.id, []);
  for (const c of filtered) {
    if (c.folderId && folderMap.has(c.folderId)) {
      folderMap.get(c.folderId)!.push(c);
    }
  }

  // Render multi-select toolbar
  if (AppState.ui.multiSelectMode) {
    const toolbar = document.createElement('div');
    toolbar.className = 'multi-select-toolbar';
    const count = AppState.ui.selectedIds.size;
    toolbar.innerHTML = `
      <span class="select-count">${count} selected</span>
      <button class="icon-btn" id="msExportBtn" title="Export selected" aria-label="Export selected conversations">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      <button class="icon-btn" id="msDeleteBtn" title="Delete selected" aria-label="Delete selected conversations">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
      <button class="icon-btn" id="msCancelBtn" title="Cancel" aria-label="Cancel multi-select">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    el.sidebarList.appendChild(toolbar);

    toolbar.querySelector('#msExportBtn')!.addEventListener('click', () => {
      const ids = Array.from(AppState.ui.selectedIds);
      batchExport(ids, 'markdown');
    });
    toolbar.querySelector('#msDeleteBtn')!.addEventListener('click', () => {
      batchDelete(Array.from(AppState.ui.selectedIds));
    });
    toolbar.querySelector('#msCancelBtn')!.addEventListener('click', () => {
      AppState.ui.multiSelectMode = false;
      AppState.ui.selectedIds.clear();
      renderSidebar();
    });
  }

  // Render filter row (only when not searching)
  if (!searchTerm) {
    const filterRow = document.createElement('div');
    filterRow.className = 'conv-filter-row';
    const filters: [ConvFilter, string][] = [
      ['all', 'All'],
      ['pinned', 'Pinned'],
      ['starred', 'Starred'],
      ['archived', 'Archive'],
    ];
    for (const [key, label] of filters) {
      const btn = document.createElement('button');
      btn.className = 'conv-filter-btn' + (currentFilter === key ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        currentFilter = key;
        renderSidebar();
      });
      filterRow.appendChild(btn);
    }
    el.sidebarList.appendChild(filterRow);
  }

  // Render folders
  for (const folder of folders) {
    const folderConvs = folderMap.get(folder.id) || [];
    if (currentFilter !== 'all' && currentFilter !== 'archived' && !searchTerm) {
      // For pinned/starred filters, only show folder if it has matching convs
      if (currentFilter === 'pinned' && !folderConvs.some((c) => c.pinned)) continue;
      if (currentFilter === 'starred' && !folderConvs.some((c) => c.starred)) continue;
    }

    const group = document.createElement('div');
    group.className = 'folder-group';
    const expanded = AppState.ui.expandedFolderId === folder.id;

    const header = document.createElement('div');
    header.className = 'folder-header' + (expanded ? ' expanded' : '');
    header.innerHTML = `
      <span class="folder-chevron" aria-hidden="true">▶</span>
      <span class="folder-icon" aria-hidden="true">📁</span>
      <span class="folder-name">${esc(folder.name)}</span>
      <span class="folder-count">${folderConvs.length}</span>
      <div class="folder-actions">
        <button class="folder-action-btn" data-action="rename" title="Rename folder" aria-label="Rename folder">✏️</button>
        <button class="folder-action-btn" data-action="delete" title="Delete folder" aria-label="Delete folder">🗑️</button>
      </div>
    `;
    header.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.folder-action-btn')) return;
      AppState.ui.expandedFolderId = expanded ? null : folder.id;
      renderSidebar();
    });

    header.querySelector('[data-action="rename"]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt('Folder name:', folder.name);
      if (newName && newName.trim()) {
        folder.name = newName.trim();
        putFolders(folders).catch((e) => logError('putFolders', e));
        renderSidebar();
      }
    });

    header.querySelector('[data-action="delete"]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete folder "${folder.name}"? Conversations will be moved to root.`)) return;
      for (const c of AppState.conversations.list) {
        if (c.folderId === folder.id) c.folderId = undefined;
      }
      AppState.ui.folders = AppState.ui.folders.filter((f) => f.id !== folder.id);
      deleteFolderById(folder.id).catch((e) => logError('deleteFolder', e));
      const { putConversations } = require('./conversation.js');
      putConversations(AppState.conversations.list).catch(() => {});
      renderSidebar();
    });

    group.appendChild(header);

    const items = document.createElement('div');
    items.className = 'folder-items' + (expanded ? '' : ' collapsed');
    if (expanded) {
      for (const conv of folderConvs) {
        items.appendChild(buildConversationNode(conv));
      }
    }
    group.appendChild(items);
    el.sidebarList.appendChild(group);
  }

  // Render unfiled conversations
  for (const conv of unfiled) {
    el.sidebarList.appendChild(buildConversationNode(conv));
  }

  // Empty state
  if (filtered.length === 0 && !searchTerm) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:32px 16px;color:var(--text-muted);font-size:12px;';
    empty.textContent = currentFilter === 'archived' ? 'No archived conversations' : 'No conversations yet';
    el.sidebarList.appendChild(empty);
  }
}

function buildConversationNode(conv: Conversation): HTMLElement {
  const div = document.createElement('div');
  div.className = 'conversation-item';
  div.dataset.convId = conv.id;
  div.setAttribute('role', 'option');
  div.setAttribute('tabindex', '0');
  div.setAttribute('draggable', 'true');
  if (conv.pinned) div.classList.add('pinned');
  if (AppState.ui.selectedIds.has(conv.id)) div.classList.add('selected');

  const isSelected = AppState.ui.selectedIds.has(conv.id);
  const preview = lastMessageText(conv);
  const relTime = timeAgo(conv.updatedAt);
  const snippet =
    (el.sidebarSearch?.value || '').trim() && !conv.title.toLowerCase().includes((el.sidebarSearch?.value || '').toLowerCase())
      ? firstMatchSnippet(conv, (el.sidebarSearch?.value || '').toLowerCase())
      : null;

  // Badges
  const badges: string[] = [];
  if (conv.pinned) badges.push('📌');
  if (conv.starred) badges.push('⭐');

  div.innerHTML = `
    <div class="conv-top">
      <div class="conv-select-check${isSelected ? ' checked' : ''}" role="checkbox" aria-checked="${isSelected}" aria-label="Select conversation" tabindex="0"></div>
      ${badges.length ? `<span class="conv-badges">${badges.map((b) => `<span class="conv-badge">${b}</span>`).join('')}</span>` : ''}
      <span class="conv-title" title="${esc(conv.title)}" role="button" tabindex="0">${esc(conv.title)}</span>
    </div>
    ${snippet ? `<div class="conv-snippet" aria-label="Matching content">${esc(snippet)}</div>` : `<div class="conv-snippet" title="${esc(preview)}">${esc(preview)}</div>`}
    <div class="conv-bottom">
      <div class="conv-meta">
        <span class="conv-relative-time">${relTime}</span>
        <span class="conv-msg-count">${conv.messages.length} msgs</span>
      </div>
      <div class="conv-actions" role="group" aria-label="Conversation actions">
        <span class="conv-action conv-star-btn${conv.starred ? ' starred' : ''}" title="${conv.starred ? 'Unstar' : 'Star'}" role="button" tabindex="0" aria-label="${conv.starred ? 'Unstar conversation' : 'Star conversation'}">${conv.starred ? '⭐' : '☆'}</span>
        <span class="conv-action conv-pin-btn${conv.pinned ? ' pinned' : ''}" title="${conv.pinned ? 'Unpin' : 'Pin'}" role="button" tabindex="0" aria-label="${conv.pinned ? 'Unpin conversation' : 'Pin conversation'}">${conv.pinned ? '📌' : '📍'}</span>
        <span class="conv-action rename-action" title="Rename" role="button" tabindex="0" aria-label="Rename conversation">✏️</span>
        <span class="conv-action archive-action" title="${conv.archived ? 'Unarchive' : 'Archive'}" role="button" tabindex="0" aria-label="${conv.archived ? 'Unarchive conversation' : 'Archive conversation'}">${conv.archived ? '📤' : '📥'}</span>
        <span class="conv-action delete-action" title="Delete" role="button" tabindex="0" aria-label="Delete conversation">🗑️</span>
      </div>
    </div>
    <div class="conv-preview-tooltip" aria-hidden="true">${esc(preview)}</div>
  `;

  // Event: select checkbox
  const checkbox = div.querySelector('.conv-select-check')!;
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSelect(conv.id);
  });
  checkbox.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      toggleSelect(conv.id);
    }
  });

  // Event: click title → open
  const titleEl = div.querySelector('.conv-title')!;
  titleEl.addEventListener('click', () => {
    if (AppState.ui.multiSelectMode) { toggleSelect(conv.id); return; }
    setCurrentConvId(conv.id);
    selectConversation(conv.id);
    closeSidebar();
  });
  titleEl.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      if (AppState.ui.multiSelectMode) { toggleSelect(conv.id); return; }
      setCurrentConvId(conv.id);
      selectConversation(conv.id);
      closeSidebar();
    }
  });

  // Event: star
  const starBtn = div.querySelector('.conv-star-btn')!;
  starBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleStar(conv.id); });
  starBtn.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault(); e.stopPropagation(); toggleStar(conv.id);
    }
  });

  // Event: pin
  const pinBtn = div.querySelector('.conv-pin-btn')!;
  pinBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePin(conv.id); });
  pinBtn.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault(); e.stopPropagation(); togglePin(conv.id);
    }
  });

  // Event: rename
  const renameBtn = div.querySelector('.rename-action')!;
  renameBtn.addEventListener('click', (e) => { e.stopPropagation(); renameConversation(conv.id); });
  renameBtn.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault(); e.stopPropagation(); renameConversation(conv.id);
    }
  });

  // Event: archive/unarchive
  const archiveBtn = div.querySelector('.archive-action')!;
  archiveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    conv.archived ? unarchiveConversation(conv.id) : archiveConversation(conv.id);
  });
  archiveBtn.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault(); e.stopPropagation();
      conv.archived ? unarchiveConversation(conv.id) : archiveConversation(conv.id);
    }
  });

  // Event: delete
  const deleteBtn = div.querySelector('.delete-action')!;
  deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteConversation(conv.id); });
  deleteBtn.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault(); e.stopPropagation(); deleteConversation(conv.id);
    }
  });

  // Event: whole row click
  div.addEventListener('click', () => {
    if (AppState.ui.multiSelectMode) { toggleSelect(conv.id); return; }
    setCurrentConvId(conv.id);
    selectConversation(conv.id);
    closeSidebar();
  });
  div.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      if (AppState.ui.multiSelectMode) { toggleSelect(conv.id); return; }
      setCurrentConvId(conv.id);
      selectConversation(conv.id);
      closeSidebar();
    }
  });

  // Drag & drop
  div.addEventListener('dragstart', (e) => {
    e.dataTransfer!.setData('text/plain', conv.id);
    e.dataTransfer!.effectAllowed = 'move';
    div.style.opacity = '0.5';
  });
  div.addEventListener('dragend', () => { div.style.opacity = ''; });
  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    div.classList.add('drag-over');
  });
  div.addEventListener('dragleave', () => { div.classList.remove('drag-over'); });
  div.addEventListener('drop', (e) => {
    e.preventDefault();
    div.classList.remove('drag-over');
    const dragId = e.dataTransfer!.getData('text/plain');
    if (dragId === conv.id) return;
    // Move to same folder as target
    moveToFolder(dragId, conv.folderId || '');
  });

  return div;
}

function toggleSelect(id: string): void {
  if (AppState.ui.selectedIds.has(id)) {
    AppState.ui.selectedIds.delete(id);
  } else {
    AppState.ui.selectedIds.add(id);
  }
  if (AppState.ui.selectedIds.size === 0) {
    AppState.ui.multiSelectMode = false;
  }
  renderSidebar();
}

function enterMultiSelect(id: string): void {
  AppState.ui.multiSelectMode = true;
  AppState.ui.selectedIds.add(id);
  renderSidebar();
}

// ---- Listeners --------------------------------------------------------------

export function setupSidebarListeners(): void {
  el.sidebarSearch?.addEventListener('input', () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(renderSidebar, 150);
  });

  el.newChatBtn.addEventListener('click', () => {
    newConversation();
    closeSidebar();
  });

  // Export button → open multi-select with current conversation
  el.exportBtn?.addEventListener('click', () => {
    const conv = getConversations().find((c) => c.id === AppState.conversations.currentId);
    if (conv) enterMultiSelect(conv.id);
  });

  // Load folders on startup
  loadFolders();
}

async function loadFolders(): Promise<void> {
  try {
    AppState.ui.folders = await getAllFolders();
  } catch (e) {
    logError('loadFolders', e);
    AppState.ui.folders = [];
  }
}
