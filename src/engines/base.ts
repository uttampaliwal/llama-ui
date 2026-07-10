export interface ModelInfo {
  name: string;
  id: string;
  size: number;
  sizeFormatted: string;
  provider: string;
  capabilities: string[];
}

/** Detect capabilities from model name/id for engines without GGUF metadata. */
export function detectCapabilitiesFromName(modelName: string): string[] {
  const lower = modelName.toLowerCase();
  const caps: string[] = [];

  // Vision
  if (
    lower.includes('vision') ||
    lower.includes('vl') ||
    lower.includes('vlm') ||
    lower.includes('llava') ||
    lower.includes('cogvlm') ||
    lower.includes('idefics') ||
    lower.includes('paligemma') ||
    lower.includes('florence') ||
    lower.includes('minicpmv') ||
    lower.includes('qwen2-vl') ||
    lower.includes('qwen2.5-vl')
  ) {
    caps.push('vision');
  }

  // Embedding
  if (
    lower.includes('embed') ||
    lower.includes('e5-') ||
    lower.includes('bge-') ||
    lower.includes('text-embedding') ||
    lower.includes('gte-')
  ) {
    caps.push('embedding');
  }

  // Reasoning
  if (
    lower.includes('qwq') ||
    lower.includes('deepseek-r1') ||
    lower.includes('deepseek-reasoner') ||
    lower.includes('think') ||
    lower.includes('qwen3') ||
    lower.includes('gemma4') ||
    lower.includes('o1-') ||
    lower.includes('o3-')
  ) {
    caps.push('reasoning');
  }

  // Tools / function calling
  if (
    lower.includes('tool') ||
    lower.includes('function') ||
    lower.includes('gpt-4') ||
    lower.includes('gpt-4o') ||
    lower.includes('gpt-4.1') ||
    lower.includes('claude-3') ||
    lower.includes('claude-4') ||
    lower.includes('command-r') ||
    lower.includes('mistral-large') ||
    lower.includes('mixtral-8x22b') ||
    lower.includes('qwen2.5-7') ||
    lower.includes('qwen2.5-14') ||
    lower.includes('qwen2.5-32') ||
    lower.includes('qwen2.5-72') ||
    lower.includes('llama-3.1') ||
    lower.includes('llama-3.3') ||
    lower.includes('llama-4')
  ) {
    caps.push('tools');
    caps.push('functionCalling');
  }

  // Code
  if (
    lower.includes('code') ||
    lower.includes('coder') ||
    lower.includes('starcoder') ||
    lower.includes('deepseek-coder') ||
    lower.includes('qwen2.5-coder')
  ) {
    caps.push('code');
  }

  return caps;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  maxTokens?: number;
  contextSize?: number;
}

export interface GenerateResult {
  stream: AsyncGenerator<string>;
}

export interface HealthStatus {
  status: 'ok' | 'error' | 'starting' | 'stopped';
  engine: string;
  detail?: string;
}

export interface EngineConfig {
  [key: string]: unknown;
}

export abstract class LLMEngine {
  abstract readonly id: string;
  abstract readonly name: string;

  protected config: EngineConfig = {};
  protected _running = false;
  protected _activeModel: string | null = null;

  get running(): boolean {
    return this._running;
  }

  get activeModel(): string | null {
    return this._activeModel;
  }

  /** Record the model the user switched to so generate() can target it. */
  setActiveModel(model: string | null): void {
    this._activeModel = model;
  }

  abstract configure(config: EngineConfig): void;
  abstract start(modelPath: string): Promise<{ success: boolean; port?: number }>;
  abstract stop(): Promise<{ success: boolean }>;
  abstract listModels(): Promise<ModelInfo[]>;
  abstract generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult>;
  abstract health(): Promise<HealthStatus>;
}

export type EngineConstructor = new () => LLMEngine;
