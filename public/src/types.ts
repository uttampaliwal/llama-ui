export type Role = 'user' | 'assistant' | 'system';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentPart = TextPart | ImagePart;

export type MessageContent = string | ContentPart[];

export interface ChatMessage {
  id: string;
  role: Role;
  content: MessageContent;
  createdAt?: string;
  thinking?: string;
}

/** A message as sent to the chat API (no client-only fields like id). */
export interface PayloadMessage {
  role: Role;
  content: MessageContent;
}

export type ExportFormat = 'markdown' | 'json';

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  _backup?: ChatMessage[];
}

export interface ModelInfo {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  folder: string;
  capabilities: string[];
}

export interface Settings {
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  contextSize: number;
  gpuLayers: number;
  threads: number;
  repeatPenalty: number;
  systemPrompt: string;
}

export type Preset = Partial<Record<keyof Settings, string>>;

export interface ChatDelta {
  content?: string;
}

export interface ChatChoice {
  delta?: ChatDelta;
  message?: { content?: string };
}

export interface ChatChunk {
  choices?: ChatChoice[];
}

export interface ChatCompletionResponse {
  choices?: ChatChoice[];
}

export interface StatusResponse {
  running: boolean;
  currentModel: string | null;
  port: number;
}

export interface StartServerResponse {
  success: boolean;
  port?: number;
  error?: string;
}

export function textOf(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n');
}

// ---- Attachments ------------------------------------------------------------

export type AttachKind =
  | 'image'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'zip'
  | 'code'
  | 'text';

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  kind: AttachKind;
  dataUrl?: string;
  text?: string;
  previewHtml?: string;
  error?: string;
  truncated?: boolean;
}
