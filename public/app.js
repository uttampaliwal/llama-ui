let conversations = JSON.parse(localStorage.getItem('conversations') || '{}');
let currentConversationId = null;
let isGenerating = false;
let startTime = null;
let abortController = null;

const $ = (id) => document.getElementById(id);
const el = {
  modelSelect: $('modelSelect'), modelInfo: $('modelInfo'),
  startBtn: $('startBtn'), stopBtn: $('stopBtn'),
  statusIndicator: $('statusIndicator'), messages: $('messages'),
  welcomeScreen: $('welcomeScreen'), userInput: $('userInput'),
  sendBtn: $('sendBtn'), stopGenerateBtn: $('stopGenerateBtn'),
  tokenCount: $('tokenCount'), latency: $('latency'),
  conversationList: $('conversationList'),
  shortcutsModal: $('shortcutsModal'),
  toastContainer: $('toastContainer'),
  systemPrompt: $('systemPrompt'), chatContainer: $('chatContainer')
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

async function init() {
  await loadModels();
  await loadSettings();
  await checkStatus();
  setupListeners();
  renderConversations();
  setInterval(checkStatus, 3000);
}

async function loadModels() {
  try {
    const { models } = await api('/api/models');
    el.modelSelect.innerHTML = '<option value="">Select a model...</option>';
    models.forEach(m => {
      const o = document.createElement('option');
      o.value = m.path;
      o.textContent = `${m.name} (${m.sizeFormatted})`;
      el.modelSelect.appendChild(o);
    });
  } catch (e) { showToast('Failed to load models', 'error'); }
}

async function loadSettings() {
  try {
    const s = await api('/api/settings');
    $('temperature').value = s.temperature;
    $('temperatureVal').textContent = s.temperature;
    $('topP').value = s.topP;
    $('topPVal').textContent = s.topP;
    $('topK').value = s.topK;
    $('topKVal').textContent = s.topK;
    $('maxTokens').value = s.maxTokens;
    $('contextSize').value = s.contextSize;
    $('gpuLayers').value = s.gpuLayers;
    $('threads').value = s.threads;
    el.systemPrompt.value = s.systemPrompt;
  } catch (e) {}
}

async function checkStatus() {
  try {
    const data = await api('/api/status');
    const dot = el.statusIndicator.querySelector('.status-dot');
    const txt = el.statusIndicator.querySelector('.status-text');
    if (data.running) {
      dot.className = 'status-dot connected';
      txt.textContent = 'Connected';
      el.startBtn.disabled = true;
      el.stopBtn.disabled = false;
      el.sendBtn.disabled = false;
    } else {
      dot.className = 'status-dot';
      txt.textContent = 'Disconnected';
      el.startBtn.disabled = false;
      el.stopBtn.disabled = true;
      el.sendBtn.disabled = true;
    }
  } catch (e) {
    el.statusIndicator.querySelector('.status-dot').className = 'status-dot';
    el.statusIndicator.querySelector('.status-text').textContent = 'Error';
  }
}

function setupListeners() {
  el.startBtn.addEventListener('click', startServer);
  el.stopBtn.addEventListener('click', stopServer);
  el.sendBtn.addEventListener('click', sendMessage);
  el.stopGenerateBtn.addEventListener('click', stopGeneration);

  el.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating) sendMessage();
    }
  });

  el.userInput.addEventListener('input', () => {
    el.userInput.style.height = 'auto';
    el.userInput.style.height = Math.min(el.userInput.scrollHeight, 200) + 'px';
  });

  $('newChatBtn').addEventListener('click', newConversation);
  $('applySettings').addEventListener('click', applySettings);
  $('settingsBtn').addEventListener('click', () => el.shortcutsModal.classList.add('active'));

  document.querySelectorAll('.section-header[data-toggle]').forEach(h => {
    h.addEventListener('click', () => {
      const t = h.getAttribute('data-toggle');
      const c = $(t === 'params' ? 'paramsContent' : 'systemContent');
      h.classList.toggle('collapsed');
      c.classList.toggle('collapsed');
    });
  });

  ['temperature', 'topP', 'topK'].forEach(id => {
    $(id).addEventListener('input', (e) => $(id + 'Val').textContent = e.target.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey) {
      if (e.key === 'C') { e.preventDefault(); clearCurrentChat(); }
      else if (e.key === 'N') { e.preventDefault(); newConversation(); }
      else if (e.key === 'S') { e.preventDefault(); $('sidebar').classList.toggle('collapsed'); }
    }
  });
}

async function startServer() {
  const modelPath = el.modelSelect.value;
  if (!modelPath) return showToast('Select a model first', 'error');

  el.statusIndicator.querySelector('.status-dot').className = 'status-dot loading';
  el.statusIndicator.querySelector('.status-text').textContent = 'Starting...';
  el.startBtn.disabled = true;

  try {
    const data = await api('/api/server/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath })
    });
    if (data.success) {
      showToast('Server started', 'success');
      el.modelInfo.textContent = modelPath.split('\\').pop();
    } else {
      showToast(data.error || 'Failed to start', 'error');
    }
  } catch (e) { showToast('Failed to start server', 'error'); }
  await checkStatus();
}

async function stopServer() {
  try {
    await api('/api/server/stop', { method: 'POST' });
    showToast('Server stopped', 'success');
  } catch (e) { showToast('Failed to stop', 'error'); }
  await checkStatus();
}

async function sendMessage() {
  const content = el.userInput.value.trim();
  if (!content || isGenerating) return;

  const status = await api('/api/status');
  if (!status.running) return showToast('Start the server first', 'error');

  if (!currentConversationId) newConversation();

  const conv = conversations[currentConversationId];
  conv.messages.push({ role: 'user', content, timestamp: Date.now() });
  conv.updatedAt = Date.now();
  saveConversations();
  renderConversations();

  el.userInput.value = '';
  el.userInput.style.height = 'auto';
  hideWelcome();
  appendMessage('user', content);

  isGenerating = true;
  startTime = Date.now();
  el.sendBtn.style.display = 'none';
  el.stopGenerateBtn.style.display = 'flex';
  el.userInput.disabled = true;

  const assistantDiv = appendMessage('assistant', '', true);
  const contentDiv = assistantDiv.querySelector('.message-content');
  contentDiv.innerHTML = '';

  const thinkingEl = document.createElement('details');
  thinkingEl.className = 'thinking-block';
  thinkingEl.open = false;
  const thinkingSummary = document.createElement('summary');
  thinkingSummary.textContent = 'Thinking...';
  const thinkingContent = document.createElement('div');
  thinkingContent.className = 'thinking-content';
  thinkingEl.appendChild(thinkingSummary);
  thinkingEl.appendChild(thinkingContent);

  const responseEl = document.createElement('div');
  responseEl.className = 'response-content';

  contentDiv.appendChild(thinkingEl);
  contentDiv.appendChild(responseEl);

  let streamingText = '';
  let extractedThinking = '';

  updateLatency();

  try {
    abortController = new AbortController();

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conv.messages.filter(m => m.role !== 'system') }),
      signal: abortController.signal
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              streamingText += token;
              const extracted = extractThinking(streamingText);
              extractedThinking = extracted.thinking;

              if (extracted.thinking) {
                thinkingEl.style.display = '';
                thinkingContent.textContent = extracted.thinking;
              } else {
                thinkingEl.style.display = 'none';
              }
              responseEl.textContent = extracted.content;
              el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast(e.message, 'error');
      console.error('[Chat]', e);
    }
  }

  const cursor = contentDiv.querySelector('.cursor');
  if (cursor) cursor.remove();

  const { thinking: finalThinking, content: finalContent } = extractThinking(streamingText);
  const displayThinking = finalThinking || extractedThinking;
  conv.messages.push({ role: 'assistant', content: streamingText, timestamp: Date.now() });
  conv.updatedAt = Date.now();
  saveConversations();
  renderConversations();

  let html = '';
  if (displayThinking) {
    html += `<details class="thinking-block"><summary>Thinking...</summary><div class="thinking-content">${formatMd(displayThinking)}</div></details>`;
  }
  html += formatMd(finalContent);
  html += `<div class="message-time">${new Date().toLocaleTimeString()}</div>`;
  contentDiv.innerHTML = html;
  renderMath(contentDiv);

  isGenerating = false;
  el.sendBtn.style.display = 'flex';
  el.stopGenerateBtn.style.display = 'none';
  el.userInput.disabled = false;
  el.userInput.focus();

  const elapsed = Date.now() - startTime;
  el.latency.textContent = `${(elapsed / 1000).toFixed(1)}s`;
}

function stopGeneration() {
  if (abortController) abortController.abort();
  abortController = null;
}

function appendMessage(role, content, streaming = false) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const avatar = role === 'user' ? 'U' : 'AI';
  let rendered = '';
  if (!streaming) {
    if (role === 'assistant' && content) {
      const { thinking, content: mainContent } = extractThinking(content);
      if (thinking) {
        rendered += `<details class="thinking-block"><summary>Thinking...</summary><div class="thinking-content">${formatMd(thinking)}</div></details>`;
      }
      rendered += formatMd(mainContent);
    } else {
      rendered = formatMd(content);
    }
  }
  const time = !streaming && content ? `<div class="message-time">${new Date().toLocaleTimeString()}</div>` : '';
  div.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">${rendered}${streaming ? '<span class="cursor"></span>' : ''}${time}</div>`;
  el.messages.appendChild(div);
  if (!streaming && rendered) renderMath(div);
  el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
  return div;
}

function formatMd(text) {
  if (!text) return '';
  let t = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');

  const lines = t.split('\n');
  let result = '';
  let inList = false;
  let listType = '';

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[\*\-]\s+(.*)/);
    const numMatch = line.match(/^\s*\d+\.\s+(.*)/);

    if (bulletMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result += `</${listType}>`;
        result += '<ul>';
        inList = true;
        listType = 'ul';
      }
      result += `<li>${bulletMatch[1]}</li>`;
    } else if (numMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result += `</${listType}>`;
        result += '<ol>';
        inList = true;
        listType = 'ol';
      }
      result += `<li>${numMatch[1]}</li>`;
    } else {
      if (inList) { result += `</${listType}>`; inList = false; }
      const trimmed = line.trim();
      if (trimmed === '') {
        result += '<br>';
      } else if (trimmed.startsWith('<pre>') || trimmed.startsWith('<ul>') || trimmed.startsWith('<ol>')) {
        result += trimmed;
      } else {
        result += `<p>${trimmed}</p>`;
      }
    }
  }
  if (inList) result += `</${listType}>`;
  return result;
}

function extractThinking(text) {
  let thinking = '';
  let content = text;

  const completeRegex = /<think>[\s\S]*?<\/think>/gi;
  let match;
  while ((match = completeRegex.exec(content)) !== null) {
    const inner = match[0].replace(/^<think>/, '').replace(/<\/think>$/, '').trim();
    thinking += inner + '\n';
  }
  content = content.replace(completeRegex, '');

  const openIdx = content.lastIndexOf('');
  if (openIdx !== -1) {
    content = content.slice(0, openIdx);
  }
  return { thinking: thinking.trim(), content: content.trim() };
}

function renderMath(element) {
  if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
    MathJax.typesetPromise([element]).catch(() => {});
  }
}

function scrollToBottom() { el.chatContainer.scrollTop = el.chatContainer.scrollHeight; }
function hideWelcome() { el.welcomeScreen.style.display = 'none'; }
function showWelcome() { el.welcomeScreen.style.display = 'flex'; el.messages.innerHTML = ''; }

function newConversation() {
  const id = Date.now().toString();
  conversations[id] = { id, title: 'New Chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  currentConversationId = id;
  saveConversations();
  renderConversations();
  showWelcome();
}

function loadConversation(id) {
  currentConversationId = id;
  el.messages.innerHTML = '';
  const conv = conversations[id];
  if (!conv.messages.length) { showWelcome(); return; }
  hideWelcome();
  conv.messages.forEach(m => appendMessage(m.role, m.content));
  renderConversations();
}

function clearCurrentChat() {
  if (currentConversationId && conversations[currentConversationId]) {
    conversations[currentConversationId].messages = [];
    saveConversations();
    showWelcome();
  }
}

function deleteConversation(id) {
  delete conversations[id];
  if (currentConversationId === id) { currentConversationId = null; showWelcome(); }
  saveConversations();
  renderConversations();
}

function renderConversations() {
  const sorted = Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
  el.conversationList.innerHTML = sorted.map(c => `
    <div class="conversation-item ${c.id === currentConversationId ? 'active' : ''}" onclick="loadConversation('${c.id}')">
      <span class="title">${esc(c.title)}</span>
      <button class="icon-btn delete-btn" onclick="event.stopPropagation(); deleteConversation('${c.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>`).join('');
}

function saveConversations() {
  if (currentConversationId && conversations[currentConversationId]) {
    const c = conversations[currentConversationId];
    const first = c.messages.find(m => m.role === 'user');
    if (first) c.title = first.content.substring(0, 40) + (first.content.length > 40 ? '...' : '');
  }
  localStorage.setItem('conversations', JSON.stringify(conversations));
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

async function applySettings() {
  const s = {
    temperature: parseFloat($('temperature').value),
    topP: parseFloat($('topP').value),
    topK: parseInt($('topK').value),
    maxTokens: parseInt($('maxTokens').value),
    contextSize: parseInt($('contextSize').value),
    gpuLayers: parseInt($('gpuLayers').value),
    threads: parseInt($('threads').value),
    systemPrompt: el.systemPrompt.value
  };
  try {
    await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
    showToast('Settings saved. Restart server for context/gpu/thread changes.', 'success');
  } catch (e) { showToast('Failed to save settings', 'error'); }
}

function updateLatency() {
  if (!startTime || !isGenerating) return;
  el.latency.textContent = `...${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  requestAnimationFrame(updateLatency);
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  el.toastContainer.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 200); }, 4000);
}

document.addEventListener('DOMContentLoaded', init);
