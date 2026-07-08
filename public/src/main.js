import { el, $, showShortcuts, closeSidebar } from './utils.js';
import { showToast } from './toast.js';
import { loadModels, updateModelInfo } from './models.js';
import { loadSettings, applySettings, renderPresets, applyPreset, savePreset, deletePreset } from './settings.js';
import { setupAttachmentListeners } from './attachments.js';
import { sendMessage, stopGeneration, restartConversation, regenerateFrom } from './chat.js';
import { getConversations, getCurrentConv, saveConversations, renderConversation, exportConversation, newConversation, selectConversation } from './conversation.js';
import { checkStatus, startServer, stopServer } from './server.js';
import { renderSidebar, setupSidebarListeners } from './sidebar.js';

function init() {
  try {
    const savedConvId = localStorage.getItem('currentConversationId');
    const convs = getConversations();

    if (savedConvId && convs.find(c => c.id === savedConvId)) {
      selectConversation(savedConvId);
    }
  } catch (e) {
    console.warn('Init state error:', e);
  }

  renderSidebar();
  renderPresets();
  loadModels().catch(() => {});
  loadSettings().catch(() => {});
  checkStatus().catch(() => {});
  setupAttachmentListeners();
  setupSidebarListeners();

  // Slider live value display
  ['temperature', 'topP', 'topK', 'repeatPenalty'].forEach(id => {
    const elSlider = $(id);
    if (elSlider) elSlider.addEventListener('input', (e) => {
      const valEl = $(id + 'Val');
      if (valEl) valEl.textContent = e.target.value;
    });
  });

  // Status polling
  setInterval(checkStatus, 3000);

  el.sendBtn.addEventListener('click', sendMessage);

  el.stopGenerateBtn.addEventListener('click', stopGeneration);

  el.restartBtn.addEventListener('click', restartConversation);

  el.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  el.userInput.addEventListener('input', () => {
    el.userInput.style.height = 'auto';
    el.userInput.style.height = el.userInput.scrollHeight + 'px';
  });

  el.startBtn.addEventListener('click', startServer);
  el.stopBtn.addEventListener('click', stopServer);

  el.refreshModelsBtn.addEventListener('click', loadModels);

  el.modelSelect.addEventListener('change', updateModelInfo);

  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(tab.dataset.tab === 'params' ? 'settingsParams' : tab.dataset.tab === 'system' ? 'settingsSystem' : 'settingsPresets').classList.add('active');
    });
  });

  el.applySettings.addEventListener('click', applySettings);

  el.presetSelect.addEventListener('change', () => {
    if (el.presetSelect.value) applyPreset(el.presetSelect.value);
  });

  el.savePresetBtn.addEventListener('click', savePreset);
  el.deletePresetBtn.addEventListener('click', deletePreset);

  el.settingsBtn.addEventListener('click', () => el.settingsModal.classList.add('active'));

  document.querySelectorAll('.modal-header .icon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) modal.classList.remove('active');
    });
  });

  el.exportBtn.addEventListener('click', () => {
    const modal = $('exportModal');
    if (modal) modal.classList.add('active');
  });

  const exportModal = $('exportModal');
  if (exportModal) {
    exportModal.querySelectorAll('.export-option').forEach(opt => {
      opt.addEventListener('click', () => {
        exportConversation(opt.dataset.format);
        exportModal.classList.remove('active');
      });
    });
    exportModal.addEventListener('click', (e) => {
      if (e.target === exportModal) exportModal.classList.remove('active');
    });
    const closeBtn = exportModal.querySelector('#exportCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => exportModal.classList.remove('active'));
  }

  el.menuBtn?.addEventListener('click', () => {
    el.sidebar.classList.toggle('open');
    if (el.sidebarOverlay) el.sidebarOverlay.classList.toggle('open');
  });

  el.collapseBtn?.addEventListener('click', closeSidebar);
  el.sidebarOverlay?.addEventListener('click', closeSidebar);

  el.sidebarExpandBtn?.addEventListener('click', () => {
    el.sidebar.classList.add('open');
    if (el.sidebarOverlay) el.sidebarOverlay.classList.add('open');
  });

  el.scrollBottomBtn?.addEventListener('click', () => {
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey) {
      switch (e.key) {
        case 'C':
        case 'c': e.preventDefault(); restartConversation(); break;
        case 'N':
        case 'n': e.preventDefault(); newConversation(); renderSidebar(); break;
        case 'S':
        case 's': e.preventDefault(); el.sidebar.classList.toggle('open'); if (el.sidebarOverlay) el.sidebarOverlay.classList.toggle('open'); break;
      }
    }
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
  });

  el.chatMessages.addEventListener('click', (e) => {
    const target = e.target;
    const msgEl = target.closest('.message');
    if (!msgEl) return;
    const msgId = msgEl.dataset.messageId;

    if (target.classList.contains('delete-message-btn')) {
      const conv = getCurrentConv();
      if (!conv) return;
      conv.messages = conv.messages.filter(m => m.id !== msgId);
      saveConversations();
      renderConversation(conv);
      return;
    }

    if (target.classList.contains('copy-message-btn')) {
      const conv = getCurrentConv();
      if (!conv) return;
      const msg = conv.messages.find(m => m.id === msgId);
      if (msg) {
        navigator.clipboard.writeText(msg.content).then(() => {
          showToast('Copied to clipboard', 'success');
        });
      }
      return;
    }

    if (target.classList.contains('edit-message-btn')) {
      const conv = getCurrentConv();
      if (!conv) return;
      const msg = conv.messages.find(m => m.id === msgId);
      if (msg) {
        const newContent = prompt('Edit message:', msg.content);
        if (newContent !== null && newContent.trim()) {
          msg.content = newContent;
          saveConversations();
          renderConversation(conv);
        }
      }
      return;
    }

    if (target.classList.contains('regenerate-btn')) {
      regenerateFrom(msgId);
      return;
    }
  });

  el.chatMessages.addEventListener('scroll', () => {
    const threshold = 100;
    const atBottom = el.chatMessages.scrollHeight - el.chatMessages.scrollTop - el.chatMessages.clientHeight < threshold;
    el.scrollBottomBtn.classList.toggle('visible', !atBottom);
  });

  // Restore sidebar width
  const savedWidth = localStorage.getItem('sidebarWidth');
  if (savedWidth) {
    el.sidebar.style.width = savedWidth + 'px';
    el.sidebar.style.flex = 'none';
  }

  const sidebarResizeHandle = $('sidebarResizeHandle');
  if (sidebarResizeHandle) {
    let isResizing = false;
    sidebarResizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newWidth = Math.max(200, Math.min(500, e.clientX));
      el.sidebar.style.width = newWidth + 'px';
      el.sidebar.style.flex = 'none';
    });
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('sidebarWidth', parseInt(el.sidebar.style.width));
      }
    });
  }

  document.querySelectorAll('.quick-action').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (btn.textContent.includes('Keyboard Shortcuts')) {
        showShortcuts();
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
