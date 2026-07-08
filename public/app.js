let conversations = JSON.parse(localStorage.getItem('conversations') || '{}');
Object.values(conversations).forEach(c => { if (c.titleEdited === undefined) c.titleEdited = false; });
let currentConversationId = null;
let isGenerating = false;
let startTime = null;
let abortController = null;
let modelMap = {};
let streamTokenCount = 0;

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
  systemPrompt: $('systemPrompt'), chatContainer: $('chatContainer'),
  sidebar: $('sidebar')
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
  renderPresets();
  setInterval(checkStatus, 3000);
}

async function loadModels() {
  try {
    const { models } = await api('/api/models');
    modelMap = {};
    el.modelSelect.innerHTML = '<option value="">Select a model...</option>';
    models.forEach(m => {
      modelMap[m.path] = m;
      const o = document.createElement('option');
      o.value = m.path;
      o.textContent = `${m.name} (${m.sizeFormatted})`;
      el.modelSelect.appendChild(o);
    });
  } catch (e) { showToast('Failed to load models', 'error'); }
}

function updateModelInfo() {
  const path = el.modelSelect.value;
  const m = modelMap[path];
  if (!m) { el.modelInfo.textContent = ''; return; }
  const ctx = parseInt($('contextSize').value) || '-';
  const gpu = parseInt($('gpuLayers').value) || '-';
  const thr = parseInt($('threads').value) || '-';
  el.modelInfo.textContent = `${m.name} · ${m.sizeFormatted} · ctx ${ctx} · GPU ${gpu} · ${thr}T`;
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
    $('repeatPenalty').value = s.repeatPenalty;
    $('repeatPenaltyVal').textContent = s.repeatPenalty;
    el.systemPrompt.value = s.systemPrompt;
    updateModelInfo();
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
  el.modelSelect.addEventListener('change', updateModelInfo);

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
  $('settingsBtn').addEventListener('click', showShortcuts);
  $('menuBtn').addEventListener('click', () => el.sidebar.classList.toggle('open'));

  $('refreshModelsBtn').addEventListener('click', async () => {
    $('refreshModelsBtn').classList.add('loading');
    await loadModels();
    $('refreshModelsBtn').classList.remove('loading');
    showToast('Model list refreshed', 'success');
  });

  $('savePresetBtn').addEventListener('click', savePreset);
  $('deletePresetBtn').addEventListener('click', deletePreset);
  $('presetSelect').addEventListener('change', (e) => {
    if (e.target.value) applyPreset(e.target.value);
    e.target.value = '';
  });

  $('exportBtn').addEventListener('click', showExportModal);

  el.convSearch = $('convSearch');
  if (el.convSearch) {
    el.convSearch.addEventListener('input', () => renderConversations());
  }

  el.chatContainer.addEventListener('scroll', () => {
    const btn = $('scrollBottomBtn');
    const threshold = 400;
    const atBottom = el.chatContainer.scrollHeight - el.chatContainer.scrollTop - el.chatContainer.clientHeight < threshold;
    btn.classList.toggle('visible', !atBottom);
  });

  $('scrollBottomBtn').addEventListener('click', () => {
    el.chatContainer.scrollTo({ top: el.chatContainer.scrollHeight, behavior: 'smooth' });
  });

  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('active'); });
  });

  document.querySelectorAll('.section-header[data-toggle]').forEach(h => {
    h.addEventListener('click', () => {
      const t = h.getAttribute('data-toggle');
      const c = $(t === 'params' ? 'paramsContent' : 'systemContent');
      h.classList.toggle('collapsed');
      c.classList.toggle('collapsed');
    });
  });

  ['temperature', 'topP', 'topK', 'repeatPenalty'].forEach(id => {
    $(id).addEventListener('input', (e) => $(id + 'Val').textContent = e.target.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => {
        if (m.id === 'shortcutsModal') m.classList.remove('active');
        else m.remove();
      });
    }
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

  const s = collectSettings();
  if (!s) return;
  await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });

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
      updateModelInfo();
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
  el.tokenCount.textContent = '';
  el.latency.textContent = '';

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
  let lastUsage = null;
  streamTokenCount = 0;

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
             if (parsed.usage) lastUsage = parsed.usage;
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) {
               streamTokenCount++;
               el.tokenCount.textContent = `${streamTokenCount} tok · ${((Date.now() - startTime) / 1000).toFixed(1)}s`;
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

  const answer = finalContent || displayThinking;
  contentDiv.innerHTML = buildMessageHtml(displayThinking, finalContent);
  renderMath(contentDiv);
  highlightCodeBlocks();

  const existingToolbar = assistantDiv.querySelector('.message-toolbar');
  if (!existingToolbar) {
    const toolbar = document.createElement('div');
    toolbar.className = 'message-toolbar';
    toolbar.innerHTML = `
      <button class="icon-btn" title="Copy" data-action="copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
      <button class="icon-btn" title="Regenerate" data-action="regenerate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
      <button class="icon-btn danger" title="Delete" data-action="delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
    assistantDiv.querySelector('.message-content').appendChild(toolbar);
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const msgIndex = Array.from(el.messages.children).indexOf(assistantDiv);
      if (action === 'copy') {
        copyTextToClipboard(answer || streamingText);
      } else if (action === 'delete') {
        if (msgIndex >= 0) deleteMessageAt(msgIndex);
      } else if (action === 'regenerate') {
        if (msgIndex >= 0) regenerateFrom(msgIndex);
      }
    });
  }

  isGenerating = false;
  el.sendBtn.style.display = 'flex';
  el.stopGenerateBtn.style.display = 'none';
  el.userInput.disabled = false;
  el.userInput.focus();

  const elapsed = Date.now() - startTime;
  el.latency.textContent = `${(elapsed / 1000).toFixed(1)}s`;
  if (lastUsage) {
    const tps = lastUsage.completion_tokens && elapsed
      ? (lastUsage.completion_tokens / (elapsed / 1000)).toFixed(1)
      : null;
    el.tokenCount.textContent = `${lastUsage.completion_tokens || 0} tok${tps ? ` · ${tps}/s` : ''}`;
  }
}

function stopGeneration() {
  if (abortController) abortController.abort();
  abortController = null;
}

function appendMessage(role, content, streaming = false) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const avatar = role === 'user' ? 'U' : 'AI';
  let copyText = '';
  let inner = '';
  if (!streaming) {
    if (role === 'assistant' && content) {
      const { thinking, content: mainContent } = extractThinking(content);
      inner = buildMessageHtml(thinking, mainContent);
      copyText = mainContent || thinking;
    } else {
      inner = formatMd(content) + `<div class="message-time">${new Date().toLocaleTimeString()}</div>`;
      copyText = content;
    }
  }
  const toolbarHtml = !streaming ? `<div class="message-toolbar">
    <button class="icon-btn" title="Copy" data-action="copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
    ${role === 'assistant' ? `<button class="icon-btn" title="Regenerate" data-action="regenerate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>` : ''}
    <button class="icon-btn danger" title="Delete" data-action="delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
  </div>` : '';
  div.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">${inner}${streaming ? '<span class="cursor"></span>' : ''}${toolbarHtml}</div>`;
  el.messages.appendChild(div);
  if (!streaming && inner) renderMath(div);
  if (!streaming && inner) highlightCodeBlocks();
  el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
  if (!streaming) {
    const toolbar = div.querySelector('.message-toolbar');
    if (toolbar) {
      toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const msgIndex = Array.from(el.messages.children).indexOf(div);
        if (action === 'copy') {
          copyTextToClipboard(copyText);
        } else if (action === 'delete') {
          if (msgIndex >= 0) deleteMessageAt(msgIndex);
        } else if (action === 'regenerate') {
          if (msgIndex >= 0) regenerateFrom(msgIndex);
        }
      });
    }
  }
  return div;
}

const LATEX_MATH_CMDS = new Set([
  'boxed','frac','dfrac','tfrac','sqrt','binom','overset','underset','substack','genfrac',
  'vec','bar','hat','tilde','dot','ddot','dddot','widetilde','widehat','overline','underline','overbrace','underbrace','overrightarrow','overleftarrow',
  'sum','prod','int','oint','iint','iiint','iiiint','lim','coprod','bigcup','bigcap','bigoplus','bigotimes','bigsqcup','bigvee','bigwedge',
  'leq','le','geq','ge','ne','neq','approx','approxeq','equiv','sim','simeq','cong','in','notin','subset','subseteq','supset','supseteq','subsetneq','supsetneq','mapsto','implies','impliedby','iff','forall','exists','nexists','pm','mp','times','div','cdot','ast','circ','star','oplus','otimes','langle','rangle','perp','parallel','propto','partial','nabla','infty','emptyset','setminus','cup','cap',
  'alpha','beta','gamma','delta','epsilon','varepsilon','zeta','eta','theta','vartheta','iota','kappa','lambda','mu','nu','xi','pi','varpi','rho','varrho','sigma','varsigma','tau','upsilon','phi','varphi','chi','psi','omega',
  'Gamma','Delta','Theta','Lambda','Xi','Pi','Sigma','Upsilon','Phi','Psi','Omega',
  'log','ln','sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','exp','det','gcd','min','max','sup','inf','deg','Pr','bmod','pmod','mod',
  'mathbb','mathbf','mathit','mathrm','mathcal','mathfrak','mathsf','mathtt','text','textbf','textit','textrm','operatorname','boldsymbol','bm',
  'left','right','big','Big','bigg','Bigg','quad','qquad','space',
  'begin','end','matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','cases','array','aligned','gathered','split','eqnarray','smallmatrix'
]);

function readBrace(text, start) {
  let depth = 0;
  let i = start;
  let result = '';
  for (; i < text.length; i++) {
    const c = text[i];
    result += c;
    if (c === '\\') {
      i++;
      if (i < text.length) result += text[i];
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return [result, i];
}

function stashRawLatex(text, stash) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === '\\' && i + 1 < n && /[a-zA-Z]/.test(text[i + 1])) {
      let j = i + 1;
      while (j < n && /[a-zA-Z]/.test(text[j])) j++;
      const cmd = text.slice(i + 1, j);
      if (LATEX_MATH_CMDS.has(cmd)) {
        let k = j;
        let expr = text.slice(i, j);
        let advanced = true;
        while (k < n && advanced) {
          advanced = false;
          while (k < n && /\s/.test(text[k])) { expr += text[k]; k++; }
          if (text[k] === '{') {
            const [grp, nk] = readBrace(text, k);
            expr += grp; k = nk; advanced = true;
          } else if ('^_+-=/()[]'.includes(text[k])) {
            expr += text[k]; k++; advanced = true;
          } else if (text[k] === '\\' && k + 1 < n && /[a-zA-Z]/.test(text[k + 1])) {
            let m = k + 1;
            while (m < n && /[a-zA-Z]/.test(text[m])) m++;
            const sub = text.slice(k + 1, m);
            if (LATEX_MATH_CMDS.has(sub)) { expr += text.slice(k, m); k = m; advanced = true; }
          }
        }
        out += '$' + stash(expr) + '$';
        i = k;
        continue;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

function formatMd(text) {
  if (!text) return '';

  const mathStore = [];
  const stash = (m) => {
    const escaped = m.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    mathStore.push(escaped);
    return `@@MJ${mathStore.length - 1}@@`;
  };

  let t = text
    .replace(/\$\$[\s\S]*?\$\$/g, stash)
    .replace(/\\\[[\s\S]*?\\\]/g, stash)
    .replace(/\\\([\s\S]*?\\\)/g, stash)
    .replace(/\$(?!\$)([^$\n]+?)\$(?!\$)/g, stash);

  t = stashRawLatex(t, stash);

  t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');

  const lines = t.split('\n');
  let result = '';
  let inList = false;
  let listType = '';

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    const bulletMatch = line.match(/^\s*[\*\-]\s+(.*)/);
    const numMatch = line.match(/^\s*\d+\.\s+(.*)/);

    if (headingMatch) {
      if (inList) { result += `</${listType}>`; inList = false; }
      const level = headingMatch[1].length;
      result += `<h${level}>${headingMatch[2]}</h${level}>`;
    } else if (bulletMatch) {
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
      } else if (/^---+\s*$/.test(trimmed)) {
        result += '<hr>';
      } else if (trimmed.startsWith('<pre>') || trimmed.startsWith('<ul>') || trimmed.startsWith('<ol>')) {
        result += trimmed;
      } else {
        result += `<p>${trimmed}</p>`;
      }
    }
  }
  if (inList) result += `</${listType}>`;

  for (let i = 0; i < mathStore.length; i++) {
    result = result.split('@@MJ' + i + '@@').join(mathStore[i]);
  }
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

  const openIdx = content.lastIndexOf('<think>');
  if (openIdx !== -1) {
    const tail = content.slice(openIdx + '<think>'.length);
    thinking += tail.trim() + '\n';
    content = content.slice(0, openIdx);
  }
  return { thinking: thinking.trim(), content: content.trim() };
}

function buildMessageHtml(thinking, answer) {
  let html = '';
  if (thinking) {
    html += `<details class="thinking-block"><summary>Thinking...</summary><div class="thinking-content">${formatMd(thinking)}</div></details>`;
  }
  html += formatMd(answer || '');
  if (thinking && !answer) {
    html += `<div class="truncated-note">Response truncated — the model stopped before producing an answer. Expand “Thinking…” to view its reasoning.</div>`;
  }
  html += `<div class="message-time">${new Date().toLocaleTimeString()}</div>`;
  return html;
}

function renderMath(element) {
  if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
    MathJax.typesetPromise([element]).catch(() => {});
  }
}

function highlightCodeBlocks() {
  if (typeof hljs !== 'undefined') {
    document.querySelectorAll('.message-content pre code').forEach(el => {
      try { hljs.highlightElement(el); } catch (e) {}
    });
  }
}

function copyTextToClipboard(text) {
  const finish = (ok) => showToast(ok ? 'Copied to clipboard' : 'Copy failed', ok ? 'success' : 'error');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => finish(true)).catch(() => fallbackCopy(text, finish));
  } else {
    fallbackCopy(text, finish);
  }
}

function fallbackCopy(text, finish) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  finish(ok);
}

function addCopyButton(messageEl, copyText) {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.type = 'button';
  btn.title = 'Copy';
  btn.setAttribute('aria-label', 'Copy');
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyTextToClipboard(copyText);
  });
  messageEl.appendChild(btn);
}

function scrollToBottom() { el.chatContainer.scrollTop = el.chatContainer.scrollHeight; }
function hideWelcome() { el.welcomeScreen.style.display = 'none'; }
function showWelcome() { el.welcomeScreen.style.display = 'flex'; el.messages.innerHTML = ''; }

function showShortcuts() { el.shortcutsModal.classList.add('active'); }
function closeModal(id) { const m = $(id); if (m) m.classList.remove('active'); }

function newConversation() {
  const id = Date.now().toString();
  conversations[id] = { id, title: 'New Chat', messages: [], createdAt: Date.now(), updatedAt: Date.now(), titleEdited: false };
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

function deleteMessageAt(index) {
  if (!currentConversationId || !conversations[currentConversationId]) return;
  const conv = conversations[currentConversationId];
  if (index < 0 || index >= conv.messages.length) return;
  conv.messages.splice(index, 1);
  conv.updatedAt = Date.now();
  saveConversations();
  renderConversations();
  el.messages.children[index]?.remove();
  if (!conv.messages.length) showWelcome();
}

function regenerateFrom(index) {
  if (!currentConversationId || !conversations[currentConversationId] || isGenerating) return;
  const conv = conversations[currentConversationId];
  if (index < 0 || index >= conv.messages.length) return;
  if (conv.messages[index].role !== 'assistant') return;

  conv.messages.splice(index);
  conv.updatedAt = Date.now();
  saveConversations();
  renderConversations();

  while (el.messages.children.length > index) el.messages.lastChild?.remove();

  const lastUserMsg = [...conv.messages].reverse().find(m => m.role === 'user');
  if (lastUserMsg) {
    el.userInput.value = lastUserMsg.content;
    el.userInput.style.height = 'auto';
    el.userInput.style.height = Math.min(el.userInput.scrollHeight, 200) + 'px';
    sendMessage();
  }
}

function renderConversations() {
  const query = el.convSearch ? el.convSearch.value.toLowerCase() : '';
  const sorted = Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
  const filtered = query ? sorted.filter(c => c.title.toLowerCase().includes(query)) : sorted;
  el.conversationList.innerHTML = filtered.map(c => `
    <div class="conversation-item ${c.id === currentConversationId ? 'active' : ''}" data-conv-id="${c.id}">
      <span class="title" data-editable>${esc(c.title)}</span>
      <button class="icon-btn delete-btn" data-action="delete-conv">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>`).join('');

  el.conversationList.querySelectorAll('.conversation-item').forEach(item => {
    const convId = item.dataset.convId;
    const titleEl = item.querySelector('[data-editable]');

    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="delete-conv"]')) return;
      loadConversation(convId);
    });

    item.querySelector('[data-action="delete-conv"]').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(convId);
    });

    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'title-input';
      input.value = conversations[convId].title;
      titleEl.replaceWith(input);
      input.focus();
      input.select();

      const finish = () => {
        const val = input.value.trim() || 'Untitled';
        conversations[convId].title = val;
        conversations[convId].titleEdited = true;
        saveConversations();
        renderConversations();
      };

      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); input.value = conversations[convId].title; input.blur(); }
      });
    });
  });
}

function saveConversations() {
  if (currentConversationId && conversations[currentConversationId]) {
    const c = conversations[currentConversationId];
    if (!c.titleEdited) {
      const first = c.messages.find(m => m.role === 'user');
      if (first) c.title = first.content.substring(0, 40) + (first.content.length > 40 ? '...' : '');
    }
  }
  localStorage.setItem('conversations', JSON.stringify(conversations));
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function collectSettings() {
  const s = {
    temperature: parseFloat($('temperature').value),
    topP: parseFloat($('topP').value),
    topK: parseInt($('topK').value),
    maxTokens: parseInt($('maxTokens').value),
    contextSize: parseInt($('contextSize').value),
    gpuLayers: parseInt($('gpuLayers').value),
    threads: parseInt($('threads').value),
    repeatPenalty: parseFloat($('repeatPenalty').value),
    systemPrompt: el.systemPrompt.value
  };
  if ([s.temperature, s.topP, s.topK, s.maxTokens, s.contextSize, s.gpuLayers, s.threads, s.repeatPenalty].some(v => Number.isNaN(v))) {
    showToast('Please enter valid numbers in all parameters', 'error');
    return null;
  }
  if (s.contextSize < s.maxTokens) {
    showToast('Context Size should be >= Max Tokens', 'error');
    return null;
  }
  return s;
}

async function applySettings() {
  const s = collectSettings();
  if (!s) return;
  const btn = $('applySettings');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Saving...';
  try {
    const res = await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
    if (res.error) throw new Error(res.error);
    updateModelInfo();
    showToast('Settings saved. Restart server for context/gpu/thread changes.', 'success');
  } catch (e) { showToast(e.message || 'Failed to save settings', 'error'); }
  finally { btn.disabled = false; btn.textContent = original; }
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

/* Parameter presets */
function renderPresets() {
  const presets = JSON.parse(localStorage.getItem('presets') || '{}');
  const sel = $('presetSelect');
  sel.innerHTML = '<option value="">Load preset...</option>';
  Object.keys(presets).forEach(name => {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  });
}

function applyPreset(name) {
  const presets = JSON.parse(localStorage.getItem('presets') || '{}');
  const p = presets[name];
  if (!p) return;
  $('temperature').value = p.temperature;
  $('temperatureVal').textContent = p.temperature;
  $('topP').value = p.topP;
  $('topPVal').textContent = p.topP;
  $('topK').value = p.topK;
  $('topKVal').textContent = p.topK;
  $('maxTokens').value = p.maxTokens;
  $('contextSize').value = p.contextSize;
  $('gpuLayers').value = p.gpuLayers;
  $('threads').value = p.threads;
  $('repeatPenalty').value = p.repeatPenalty;
  $('repeatPenaltyVal').textContent = p.repeatPenalty;
  el.systemPrompt.value = p.systemPrompt || '';
  showToast('Preset "' + name + '" applied', 'success');
}

function savePreset() {
  const name = prompt('Preset name:');
  if (!name) return;
  const presets = JSON.parse(localStorage.getItem('presets') || '{}');
  presets[name] = {
    temperature: $('temperature').value,
    topP: $('topP').value,
    topK: $('topK').value,
    maxTokens: $('maxTokens').value,
    contextSize: $('contextSize').value,
    gpuLayers: $('gpuLayers').value,
    threads: $('threads').value,
    repeatPenalty: $('repeatPenalty').value,
    systemPrompt: el.systemPrompt.value
  };
  localStorage.setItem('presets', JSON.stringify(presets));
  renderPresets();
  showToast('Preset "' + name + '" saved', 'success');
}

function deletePreset() {
  const sel = $('presetSelect');
  const name = sel.value;
  if (!name) return;
  if (!confirm('Delete preset "' + name + '"?')) return;
  const presets = JSON.parse(localStorage.getItem('presets') || '{}');
  delete presets[name];
  localStorage.setItem('presets', JSON.stringify(presets));
  renderPresets();
  showToast('Preset "' + name + '" deleted');
}

/* Export */
function exportConversation(format) {
  if (!currentConversationId || !conversations[currentConversationId]) {
    return showToast('No conversation to export', 'error');
  }
  const conv = conversations[currentConversationId];
  const filename = (conv.title || 'conversation').replace(/[^a-z0-9]/gi, '_').toLowerCase();

  if (format === 'json') {
    const data = JSON.stringify(conv, null, 2);
    downloadFile(data, filename + '.json', 'application/json');
  } else {
    let md = '# ' + conv.title + '\n\n';
    conv.messages.forEach(m => {
      const role = m.role === 'user' ? '**You**' : '**Assistant**';
      md += role + ' (' + new Date(m.timestamp).toLocaleString() + '):\n\n';
      const { thinking, content } = extractThinking(m.content);
      if (thinking) md += '> *Thinking:* ' + thinking + '\n\n';
      md += content + '\n\n---\n\n';
    });
    downloadFile(md, filename + '.md', 'text/markdown');
  }
  const exportOverlay = document.getElementById('exportModal');
  if (exportOverlay) exportOverlay.remove();
  showToast('Exported as ' + format.toUpperCase(), 'success');
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showExportModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'exportModal';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Export Conversation</h3>
        <button class="icon-btn" id="exportCloseBtn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="export-options">
          <div class="export-option" onclick="exportConversation('markdown')">
            <span class="export-label">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Markdown
            </span>
            <span class="export-hint">Readable text format</span>
          </div>
          <div class="export-option" onclick="exportConversation('json')">
            <span class="export-label">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              JSON
            </span>
            <span class="export-hint">Machine-readable format</span>
          </div>
        </div>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#exportCloseBtn').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

document.addEventListener('DOMContentLoaded', init);
