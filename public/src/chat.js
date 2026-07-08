import { api } from './api.js';
import { showToast } from './toast.js';
import { el, $, hideWelcome } from './utils.js';
import { extractThinking } from './markdown.js';
import { pendingAttachment } from './attachments.js';
import { modelMap, updateModelInfo } from './models.js';
import {
  getCurrentConv, saveConversations, renderMessage, renderConversation,
  newConversation, updateMessageContent, updateStreamingContent, generateTitle
} from './conversation.js';

let currentAbortController = null;
let isGenerating = false;

let editingMessageId = null;

function getEditingMessageId() {
  return editingMessageId;
}

function setEditingMessageId(id) {
  editingMessageId = id;
}

export function regenerateFrom(msgId) {
  const conv = getCurrentConv();
  if (conv) conv._backup = JSON.parse(JSON.stringify(conv.messages));
  editingMessageId = msgId;
  el.sendBtn.classList.add('regenerate-mode');
  el.sendBtn.querySelector('.btn-icon').textContent = '🔄';
  el.sendBtn.querySelector('.btn-label').textContent = 'Regenerate';
  el.restartBtn.classList.remove('hidden');
  sendMessage();
}

function resetRegenerateMode() {
  el.sendBtn.classList.remove('regenerate-mode');
  el.sendBtn.querySelector('.btn-icon').textContent = '➤';
  el.sendBtn.querySelector('.btn-label').textContent = 'Send';
  editingMessageId = null;
  el.restartBtn.classList.add('hidden');
}

export async function sendMessage() {
  if (isGenerating) return;

  const conv = getCurrentConv();
  const userInput = el.userInput.value.trim();
  let fileAttach = pendingAttachment || null;

  if (!userInput && !fileAttach && !editingMessageId) return;

  if (fileAttach && fileAttach.attachType === 'image') {
    const model = modelMap[el.modelSelect.value];
    const caps = model && model.capabilities ? model.capabilities : [];
    if (!caps.includes('vision')) {
      resetRegenerateMode();
      showToast('Selected model does not support image input', 'error');
      return;
    }
  }

  try {
    const status = await api('/api/status');
    if (!status.running) {
      resetRegenerateMode();
      showToast('Server is not running. Start the server first.', 'error');
      return;
    }
  } catch (e) {
    resetRegenerateMode();
    showToast('Cannot reach server', 'error');
    return;
  }

  isGenerating = true;

  if (!conv) newConversation();

  const currentConv = getCurrentConv();

  if (editingMessageId) {
    const msgIdx = currentConv.messages.findIndex(m => m.id === editingMessageId);
    if (msgIdx !== -1) {
      currentConv.messages = currentConv.messages.slice(0, msgIdx);
      saveConversations();
      renderConversation(currentConv);
      resetRegenerateMode();
    }
  } else {
    if (fileAttach) {
      if (fileAttach.attachType === 'image') {
        currentConv.messages.push({
          id: Date.now().toString(),
          role: 'user',
          createdAt: now,
          content: [
            { type: 'image_url', image_url: { url: fileAttach.data } },
            { type: 'text', text: userInput || 'Describe this image.' }
          ]
        });
        renderMessage(currentConv.messages[currentConv.messages.length - 1]);
      } else {
        // Truncate text attachments based on context size
        const ctxSize = parseInt($('contextSize').value) || 4096;
        const maxChars = Math.floor(ctxSize * 3.5 * 0.7);
        let fileData = fileAttach.data;
        if (fileData.length > maxChars) {
          fileData = fileData.slice(0, maxChars) + '\n\n[File truncated to ' + maxChars + ' characters]';
        }
        currentConv.messages.push({
          id: Date.now().toString(),
          role: 'user',
          createdAt: new Date().toISOString(),
          content: (userInput || '') + '\n\n[File: ' + fileAttach.name + ']\n' + fileData
        });
        renderMessage(currentConv.messages[currentConv.messages.length - 1]);
      }
      pendingAttachment = null;
      $('attachmentPreview').style.display = 'none';
      $('previewImage').src = '';
      $('previewImage').style.display = '';
      $('attachmentName').style.display = 'none';
      $('attachmentName').textContent = '';
      $('attachBtn').classList.remove('has-attachment');
    } else {
      currentConv.messages.push({
        id: Date.now().toString(),
        role: 'user',
        createdAt: new Date().toISOString(),
        content: userInput
      });
      renderMessage(currentConv.messages[currentConv.messages.length - 1]);
    }
  }

  el.userInput.value = '';
  el.userInput.style.height = 'auto';
  hideWelcome();
  el.restartBtn.classList.remove('hidden');

  saveConversations();
  if (!currentConv.title || currentConv.title === 'New Conversation') {
    currentConv.title = generateTitle(currentConv);
    el.chatTitle.textContent = currentConv.title;
    saveConversations();
    import('./sidebar.js').then(m => m.renderSidebar());
  }

  // Build payload messages, ensuring strict user/assistant alternation
  const userMsgs = [];
  for (const m of currentConv.messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      const last = userMsgs[userMsgs.length - 1];
      if (last && last.role === m.role) {
        // Skip consecutive same-role messages to satisfy Jinja template
        userMsgs[userMsgs.length - 1] = {
          role: m.role,
          content: last.content + '\n\n' + (Array.isArray(m.content) ? JSON.stringify(m.content) : m.content)
        };
      } else {
        userMsgs.push({
          role: m.role,
          content: Array.isArray(m.content) ? m.content : m.content
        });
      }
    }
  }

  const payload = {
    messages: userMsgs
  };

  currentAbortController = new AbortController();
  el.stopGenerateBtn.style.display = '';
  el.stopGenerateBtn.disabled = false;
  el.sendBtn.disabled = true;

  let startTime = Date.now();
  let streamTokenCount = 0;
  if (el.latency) el.latency.textContent = '0s';
  if (el.tokenCount) el.tokenCount.textContent = '0 tok';

  const assistantMsg = {
    id: Date.now().toString(),
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString()
  };
  currentConv.messages.push(assistantMsg);
  saveConversations();
  renderMessage(assistantMsg, true, true);

  let streamBuffer = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: currentAbortController.signal
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = 'Chat error';
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.error?.message || errJson.error || errText;
        if (errJson.error?.code === 400) errMsg = 'Server error: ' + errJson.error.message;
      } catch (e) {
        errMsg = errText || 'Chat request failed';
      }
      showToast(errMsg, 'error');
      if (currentConv._backup) {
        currentConv.messages = currentConv._backup;
        delete currentConv._backup;
        saveConversations();
        renderConversation(currentConv);
      } else {
        assistantMsg.content = '**Error:** ' + errMsg;
        updateMessageContent(assistantMsg.id, assistantMsg.content);
        saveConversations();
      }
      if (!navigator.onLine) showToast('No internet connection', 'error');
      return;
    }

    const contentType = res.headers.get('Content-Type') || '';
    if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamBuffer += decoder.decode(value, { stream: true });

        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta?.content || '';
              if (delta) streamTokenCount++;
              fullContent += delta;
              assistantMsg.content = fullContent;
              const { thinking: t, content: c } = extractThinking(fullContent);
              updateStreamingContent(assistantMsg.id, fullContent, t, c);
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              if (el.latency) el.latency.textContent = elapsed + 's';
              if (el.tokenCount) el.tokenCount.textContent = streamTokenCount + ' tok';
              saveConversations();
            } catch (e) {}
          }
        }
      }

      if (streamBuffer.trim() && !streamBuffer.trim().startsWith('data: [DONE]')) {
        try {
          const trimmed = streamBuffer.trim();
          if (trimmed.startsWith('data: ')) {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) streamTokenCount++;
            const fullContent = assistantMsg.content + delta;
            assistantMsg.content = fullContent;
            const { thinking: t, content: c } = extractThinking(fullContent);
            updateStreamingContent(assistantMsg.id, fullContent, t, c);
            updateModelInfo();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            if (el.latency) el.latency.textContent = elapsed + 's';
            if (el.tokenCount) el.tokenCount.textContent = streamTokenCount + ' tok';
            saveConversations();
          }
        } catch (e) {}
      }

      const { thinking } = extractThinking(assistantMsg.content);
      if (thinking) {
        assistantMsg.thinking = thinking;
        saveConversations();
        const { content: c } = extractThinking(assistantMsg.content);
        updateStreamingContent(assistantMsg.id, assistantMsg.content, thinking, c || assistantMsg.content);
      }

      currentConv.updatedAt = new Date().toISOString();
      saveConversations();
    } else {
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content || JSON.stringify(json);
      assistantMsg.content = text;
      updateMessageContent(assistantMsg.id, text);
      currentConv.updatedAt = new Date().toISOString();
      saveConversations();
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      assistantMsg.content += '\n\n*[Generation stopped]*';
      updateMessageContent(assistantMsg.id, assistantMsg.content);
      saveConversations();
    } else {
      showToast('Connection error: ' + e.message, 'error');
      assistantMsg.content = '**Error:** ' + e.message;
      updateMessageContent(assistantMsg.id, assistantMsg.content);
      saveConversations();
    }
  } finally {
    currentAbortController = null;
    isGenerating = false;
    el.stopGenerateBtn.disabled = true;
    el.stopGenerateBtn.style.display = 'none';
    el.sendBtn.disabled = false;
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    if (streamTokenCount > 0) {
      const tps = (streamTokenCount / parseFloat(totalTime)).toFixed(1);
      if (el.latency) el.latency.textContent = totalTime + 's';
      if (el.tokenCount) el.tokenCount.textContent = streamTokenCount + ' tok \u00B7 ' + tps + '/s';
    }
    updateModelInfo();
  }
}

export function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    const conv = getCurrentConv();
    if (conv) {
      conv.updatedAt = new Date().toISOString();
      saveConversations();
    }
  }
}

export function restartConversation() {
  isGenerating = false;
  const conv = getCurrentConv();
  if (!conv) return;
  conv.messages = [];
  conv.updatedAt = new Date().toISOString();
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  saveConversations();
  showWelcome();
  resetRegenerateMode();
}
