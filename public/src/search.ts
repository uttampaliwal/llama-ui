import { $ } from './utils.js';
import { getConversations, selectConversation } from './conversation.js';
import { textOf } from './types.js';

interface SearchResult {
  conversationId: string;
  conversationTitle: string;
  type: 'title' | 'message' | 'code';
  content: string;
  preview: string;
  matchStart: number;
  matchEnd: number;
  date: string;
}

let selected_index = -1;
let results: SearchResult[] = [];
let activeFilter = 'all';
let initialized = false;

function init(): void {
  const dialog = $('searchDialog');
  const input = $('searchInput') as HTMLInputElement;
  const resultsContainer = $('searchResults');

  if (!dialog || !input || !resultsContainer) return;

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeSearch();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.style.display !== 'none') {
      closeSearch();
    }
  });

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('input', () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearch(input.value), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateResults(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateResults(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSelectedResult();
    }
  });

  document.querySelectorAll('.search-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.search-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = (btn as HTMLElement).dataset.filter || 'all';
      performSearch(input.value);
    });
  });
}

function injectCSS(): void {
  if (document.querySelector('link[href*="search.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/search.css';
  document.head.appendChild(link);
}

export function initSearch(): void {
  if (initialized) return;
  injectCSS();
  init();
  initialized = true;
}

export function openSearch(): void {
  initSearch();
  const dialog = $('searchDialog');
  const input = $('searchInput') as HTMLInputElement;
  if (!dialog || !input) return;

  dialog.style.display = 'flex';
  input.value = '';
  input.focus();
  selected_index = -1;
  results = [];
  renderResults();
}

export function closeSearch(): void {
  const dialog = $('searchDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
}

function performSearch(query: string): void {
  const q = query.toLowerCase().trim();
  if (!q) {
    results = [];
    renderResults();
    return;
  }

  results = [];
  const convs = getConversations();

  for (const conv of convs) {
    if (activeFilter === 'all' || activeFilter === 'titles') {
      if (conv.title.toLowerCase().includes(q)) {
        results.push({
          conversationId: conv.id,
          conversationTitle: conv.title,
          type: 'title',
          content: conv.title,
          preview: conv.title,
          matchStart: conv.title.toLowerCase().indexOf(q),
          matchEnd: conv.title.toLowerCase().indexOf(q) + q.length,
          date: conv.updatedAt,
        });
      }
    }

    for (const msg of conv.messages) {
      const text = textOf(msg.content);
      const lowerText = text.toLowerCase();

      if (activeFilter === 'all' || activeFilter === 'messages') {
        if (lowerText.includes(q)) {
          const matchStart = lowerText.indexOf(q);
          const preview = getPreview(text, matchStart, q.length);
          results.push({
            conversationId: conv.id,
            conversationTitle: conv.title,
            type: 'message',
            content: text,
            preview,
            matchStart: 0,
            matchEnd: 0,
            date: conv.updatedAt,
          });
        }
      }

      if (activeFilter === 'all' || activeFilter === 'code') {
        const codeMatches = text.match(/```[\s\S]*?```/g);
        if (codeMatches) {
          for (const codeBlock of codeMatches) {
            const codeContent = codeBlock.replace(/```\w*\n?/, '').replace(/```$/, '');
            if (codeContent.toLowerCase().includes(q)) {
              const matchStart = codeContent.toLowerCase().indexOf(q);
              const preview = getPreview(codeContent, matchStart, q.length);
              results.push({
                conversationId: conv.id,
                conversationTitle: conv.title,
                type: 'code',
                content: codeContent,
                preview,
                matchStart: 0,
                matchEnd: 0,
                date: conv.updatedAt,
              });
            }
          }
        }
      }
    }
  }

  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  results = results.slice(0, 50);
  selected_index = results.length > 0 ? 0 : -1;
  renderResults();
}

function getPreview(text: string, matchStart: number, matchLength: number): string {
  const contextLength = 40;
  let start = Math.max(0, matchStart - contextLength);
  let end = Math.min(text.length, matchStart + matchLength + contextLength);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(' ', end) || end;
  let preview = text.slice(start, end).trim();
  if (start > 0) preview = '...' + preview;
  if (end < text.length) preview = preview + '...';
  return preview;
}

function renderResults(): void {
  const container = $('searchResults');
  if (!container) return;

  if (results.length === 0) {
    const query = ($('searchInput') as HTMLInputElement)?.value || '';
    if (query.trim()) {
      container.innerHTML = `
        <div class="search-no-results">
          <div class="search-no-results-icon">🔍</div>
          <div class="search-no-results-text">No results found</div>
        </div>
      `;
    } else {
      container.innerHTML = '<div class="search-empty">Type to search across all conversations</div>';
    }
    return;
  }

  container.innerHTML = results
    .map(
      (r, i) => `
    <div class="search-result-item ${i === selected_index ? 'selected' : ''}" data-index="${i}" role="option">
      <div class="search-result-title">${escapeHtml(r.conversationTitle)}</div>
      <div class="search-result-preview">${escapeHtml(r.preview)}</div>
      <div class="search-result-meta">
        <span class="search-result-type ${r.type}">${r.type}</span>
        <span>${timeAgo(r.date)}</span>
      </div>
    </div>
  `,
    )
    .join('');

  container.querySelectorAll('.search-result-item').forEach((item) => {
    item.addEventListener('click', () => {
      const index = parseInt((item as HTMLElement).dataset.index || '0');
      selected_index = index;
      openSelectedResult();
    });
  });
}

function navigateResults(direction: number): void {
  if (results.length === 0) return;
  selected_index += direction;
  if (selected_index < 0) selected_index = results.length - 1;
  if (selected_index >= results.length) selected_index = 0;
  renderResults();
  const container = $('searchResults');
  const selected = container?.querySelector('.search-result-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function openSelectedResult(): void {
  if (selected_index < 0 || selected_index >= results.length) return;
  const result = results[selected_index];
  selectConversation(result.conversationId);
  closeSearch();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
