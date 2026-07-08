import type { Conversation, ModelInfo, Attachment } from './types.js';

// ---------------------------------------------------------------------------
// Centralised application state – single source of truth for all mutable
// globals that were previously scattered across modules.
// ---------------------------------------------------------------------------

export const AppState = {
  /** In-flight chat generation state */
  chat: {
    isGenerating: false,
    abortController: null as AbortController | null,
    editingMessageId: null as string | null,
  },

  /** Conversation data + virtual-scroll bookkeeping */
  conversations: {
    list: [] as Conversation[],
    currentId: null as string | null,
  },

  /** Pending file attachments for the next message */
  attachments: [] as Attachment[],

  /** Loaded model metadata keyed by path */
  models: {} as Record<string, ModelInfo>,
};

// ---------------------------------------------------------------------------
// Convenience helpers – thin wrappers that keep call-sites clean.
// ---------------------------------------------------------------------------

export function getCurrentConv(): Conversation | null {
  const { list, currentId } = AppState.conversations;
  return list.find((c) => c.id === currentId) || null;
}

export function setCurrentConvId(id: string | null): void {
  AppState.conversations.currentId = id;
  if (id) localStorage.setItem('currentConversationId', id);
  else localStorage.removeItem('currentConversationId');
}
