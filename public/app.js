const API_BASE = '';
let ws = null;
let conversations = JSON.parse(localStorage.getItem('conversations') || '{}');
let currentConversationId = null;
let isGenerating = false;
let startTime = null;

const elements = {
  modelSelect: document.getElementById('modelSelect'),
  modelInfo: document.getElementById('modelInfo'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  statusIndicator: document.getElementById('statusIndicator'),
  messages: document.getElementById('messages'),
  welcomeScreen: document.getElementById('welcomeScreen'),
  userInput: document.getElementById('userInput'),
  sendBtn: document.getElementById('sendBtn'),
  stopGenerateBtn: document.getElementById('stopGenerateBtn'),
  tokenCount: document.getElementById('tokenCount'),
  latency: document.getElementById('latency'),
  conversationList: document.getElementById('conversationList'),
  shortcutsModal: document.getElementById('shortcutsModal'),
  toastContainer: document.getElementById('toastContainer'),
  systemPrompt: document.getElementById('systemPrompt')
};

async function init() {
  await loadModels();
  await loadSettings();
  await checkStatus();
  setupEventListeners();
  setupWebSocket();
  renderConversations();
  setInterval(checkStatus, 5000);
}

async function loadModels() {
  try {
    const res = await fetch(`${API_BASE}/api/models`);
    const data = await res.json();
    elements.modelSelect.innerHTML = '<option value="">Select a model...</option>';
    data.models.forEach(model => {
      const opt = document.createElement('option');
      opt.value = model.path;
      opt.textContent = `${model.name} (${model.sizeFormatted})`;
      elements.modelSelect.appendChild(opt);
    });
  } catch (e) {
    showToast('Failed to load models', 'error');
  }
}

async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    const settings = await res.json();
    document.getElementById('temperature').value = settings.temperature;
    document.getElementById('temperatureVal').textContent = settings.temperature;
    document.getElementById('topP').value = settings.topP;
    document.getElementById('topPVal').textContent = settings.topP;
    document.getElementById('topK').value = settings.topK;
    document.getElementById('topKVal').textContent = settings.topK;
    document.getElementById('maxTokens').value = settings.maxTokens;
    document.getElementById('contextSize').value = settings.contextSize;
    document.getElementById('gpuLayers').value = settings.gpuLayers;
    document.getElementById('threads').value = settings.threads;
    elements.systemPrompt.value = settings.systemPrompt;
  } catch (e) {}
}

async function checkStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();
    const dot = elements.statusIndicator.querySelector('.status-dot');
    const text = elements.statusIndicator.querySelector('.status-text');
    
    if (data.running) {
      dot.className = 'status-dot connected';
      text.textContent = 'Connected';
      elements.startBtn.disabled = true;
      elements.stopBtn.disabled = false;
      elements.sendBtn.disabled = false;
    } else {
      dot.className = 'status-dot';
      text.textContent = 'Disconnected';
      elements.startBtn.disabled = false;
      elements.stopBtn.disabled = true;
      elements.sendBtn.disabled = true;
    }
  } catch (e) {
    const dot = elements.statusIndicator.querySelector('.status-dot');
    const text = elements.statusIndicator.querySelector('.status-text');
    dot.className = 'status-dot';
    text.textContent = 'Error';
  }
}

function setupEventListeners() {
  elements.startBtn.addEventListener('click', startServer);
  elements.stopBtn.addEventListener('click', stopServer);
  elements.sendBtn.addEventListener('click', sendMessage);
  elements.stopGenerateBtn.addEventListener('click', stopGeneration);
  
  elements.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating) sendMessage();
    }
  });

  elements.userInput.addEventListener('input', () => {
    elements.userInput.style.height = 'auto';
    elements.userInput.style.height = Math.min(elements.userInput.scrollHeight, 200) + 'px';
  });

  document.getElementById('newChatBtn').addEventListener('click', newConversation);
  document.getElementById('applySettings').addEventListener('click', applySettings);
  document.getElementById('settingsBtn').addEventListener('click', () => showShortcuts());

  document.querySelectorAll('.section-header[data-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      const target = header.getAttribute('data-toggle');
      const content = document.getElementById(target === 'params' ? 'paramsContent' : 'systemContent');
      header.classList.toggle('collapsed');
      content.classList.toggle('collapsed');
    });
  });

  ['temperature', 'topP', 'topK'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
      document.getElementById(id + 'Val').textContent = e.target.value;
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey) {
      if (e.key === 'C') {
        e.preventDefault();
        clearCurrentChat();
      } else if (e.key === 'N') {
        e.preventDefault();
        newConversation();
      } else if (e.key === 'S') {
        e.preventDefault();
        document.getElementById('sidebar').classList.toggle('collapsed');
      }
    }
  });
}

function setupWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'token') {
      appendToken(data.content);
    } else if (data.type === 'done') {
      finishGeneration();
    } else if (data.type === 'error') {
      showToast(data.content, 'error');
      finishGeneration();
    }
  };
  
  ws.onclose = () => {
    setTimeout(setupWebSocket, 3000);
  };
}

async function startServer() {
  const modelPath = elements.modelSelect.value;
  if (!modelPath) {
    showToast('Please select a model first', 'error');
    return;
  }

  const dot = elements.statusIndicator.querySelector('.status-dot');
  const text = elements.statusIndicator.querySelector('.status-text');
  dot.className = 'status-dot loading';
  text.textContent = 'Starting...';
  elements.startBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/server/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath })
    });
    
    const data = await res.json();
    if (data.success) {
      showToast('Server started successfully', 'success');
      elements.modelInfo.textContent = modelPath.split('\\').pop();
    } else {
      showToast(data.error || 'Failed to start server', 'error');
    }
  } catch (e) {
    showToast('Failed to start server', 'error');
  }
  
  await checkStatus();
}

async function stopServer() {
  try {
    await fetch(`${API_BASE}/api/server/stop`, { method: 'POST' });
    showToast('Server stopped', 'success');
  } catch (e) {
    showToast('Failed to stop server', 'error');
  }
  await checkStatus();
}

async function sendMessage() {
  const content = elements.userInput.value.trim();
  if (!content || isGenerating) return;

  if (!currentConversationId) {
    newConversation();
  }

  const conversation = conversations[currentConversationId];
  conversation.messages.push({ role: 'user', content, timestamp: Date.now() });
  conversation.updatedAt = Date.now();
  saveConversations();
  renderConversations();

  elements.userInput.value = '';
  elements.userInput.style.height = 'auto';
  
  hideWelcome();
  appendMessage('user', content);

  isGenerating = true;
  startTime = Date.now();
  elements.sendBtn.style.display = 'none';
  elements.stopGenerateBtn.style.display = 'flex';
  elements.userInput.disabled = true;

  const assistantDiv = appendMessage('assistant', '', true);
  const contentDiv = assistantDiv.querySelector('.message-content');

  ws.send(JSON.stringify({
    type: 'chat',
    content,
    history: conversation.messages.slice(0, -1)
  }));

  updateLatency();
}

function appendMessage(role, content, isStreaming = false) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  
  const avatar = role === 'user' ? 'U' : 'AI';
  
  div.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      ${formatContent(content)}${isStreaming ? '<span class="cursor"></span>' : ''}
      ${!isStreaming ? `<div class="message-time">${new Date().toLocaleTimeString()}</div>` : ''}
    </div>
  `;
  
  elements.messages.appendChild(div);
  scrollToBottom();
  return div;
}

function appendToken(token) {
  const lastMsg = elements.messages.querySelector('.message.assistant:last-child');
  if (!lastMsg) return;
  
  const contentDiv = lastMsg.querySelector('.message-content');
  const cursor = contentDiv.querySelector('.cursor');
  
  if (cursor) {
    const textNode = document.createTextNode(token);
    cursor.parentNode.insertBefore(textNode, cursor);
  }
  
  scrollToBottom();
}

function finishGeneration() {
  const conversation = conversations[currentConversationId];
  const lastMsg = elements.messages.querySelector('.message.assistant:last-child');
  
  if (lastMsg) {
    const contentDiv = lastMsg.querySelector('.message-content');
    const cursor = contentDiv.querySelector('.cursor');
    if (cursor) cursor.remove();
    
    const content = contentDiv.textContent;
    conversation.messages.push({ 
      role: 'assistant', 
      content, 
      timestamp: Date.now() 
    });
    conversation.updatedAt = Date.now();
    saveConversations();
    renderConversations();
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date().toLocaleTimeString();
    contentDiv.appendChild(timeDiv);
  }

  isGenerating = false;
  elements.sendBtn.style.display = 'flex';
  elements.stopGenerateBtn.style.display = 'none';
  elements.userInput.disabled = false;
  elements.userInput.focus();
  
  const elapsed = Date.now() - startTime;
  elements.latency.textContent = `Latency: ${(elapsed / 1000).toFixed(1)}s`;
}

function stopGeneration() {
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
    setupWebSocket();
  }
  finishGeneration();
}

function formatContent(text) {
  if (!text) return '';
  
  let formatted = text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  
  return formatted;
}

function scrollToBottom() {
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

function hideWelcome() {
  elements.welcomeScreen.style.display = 'none';
}

function showWelcome() {
  elements.welcomeScreen.style.display = 'flex';
  elements.messages.innerHTML = '';
}

function newConversation() {
  const id = Date.now().toString();
  conversations[id] = {
    id,
    title: 'New Conversation',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  currentConversationId = id;
  saveConversations();
  renderConversations();
  showWelcome();
}

function loadConversation(id) {
  currentConversationId = id;
  elements.messages.innerHTML = '';
  
  const conversation = conversations[id];
  if (conversation.messages.length === 0) {
    showWelcome();
  } else {
    hideWelcome();
    conversation.messages.forEach(msg => {
      const div = appendMessage(msg.role, msg.content);
    });
  }
  
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
  if (currentConversationId === id) {
    currentConversationId = null;
    showWelcome();
  }
  saveConversations();
  renderConversations();
}

function renderConversations() {
  const sorted = Object.values(conversations)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  
  elements.conversationList.innerHTML = sorted.map(conv => `
    <div class="conversation-item ${conv.id === currentConversationId ? 'active' : ''}" 
         onclick="loadConversation('${conv.id}')">
      <span class="title">${escapeHtml(conv.title)}</span>
      <button class="icon-btn delete-btn" onclick="event.stopPropagation(); deleteConversation('${conv.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  `).join('');
}

function saveConversations() {
  localStorage.setItem('conversations', JSON.stringify(conversations));
  
  if (currentConversationId && conversations[currentConversationId]) {
    const conv = conversations[currentConversationId];
    const firstUserMsg = conv.messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      conv.title = firstUserMsg.content.substring(0, 40) + (firstUserMsg.content.length > 40 ? '...' : '');
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function applySettings() {
  const settings = {
    temperature: parseFloat(document.getElementById('temperature').value),
    topP: parseFloat(document.getElementById('topP').value),
    topK: parseInt(document.getElementById('topK').value),
    maxTokens: parseInt(document.getElementById('maxTokens').value),
    contextSize: parseInt(document.getElementById('contextSize').value),
    gpuLayers: parseInt(document.getElementById('gpuLayers').value),
    threads: parseInt(document.getElementById('threads').value),
    systemPrompt: elements.systemPrompt.value
  };

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    showToast('Settings applied', 'success');
  } catch (e) {
    showToast('Failed to apply settings', 'error');
  }
}

function updateLatency() {
  if (!startTime || !isGenerating) return;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  elements.latency.textContent = `Generating... ${elapsed}s`;
  requestAnimationFrame(updateLatency);
}

function showShortcuts() {
  elements.shortcutsModal.classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

document.addEventListener('DOMContentLoaded', init);
