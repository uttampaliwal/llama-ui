export interface ModelInfo {
  name: string;
  id: string;
  size: number;
  sizeFormatted: string;
  provider: string;
  capabilities: string[];
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

  get running(): boolean {
    return this._running;
  }

  abstract configure(config: EngineConfig): void;
  abstract start(modelPath: string): Promise<{ success: boolean; port?: number }>;
  abstract stop(): Promise<{ success: boolean }>;
  abstract listModels(): Promise<ModelInfo[]>;
  abstract generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult>;
  abstract health(): Promise<HealthStatus>;
}

export type EngineConstructor = new () => LLMEngine;
