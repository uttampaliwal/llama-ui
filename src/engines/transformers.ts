import { LLMEngine, type ModelInfo, type ChatMessage, type GenerateOptions, type GenerateResult, type HealthStatus, type EngineConfig } from './base';
import { toGenerator } from './stream-utils';

export interface TransformersConfig extends EngineConfig {
  model: string;
  device: string;
}

export class TransformersEngine extends LLMEngine {
  readonly id = 'transformers';
  readonly name = 'Transformers.js';

  protected engineConfig: TransformersConfig = {
    model: 'Xenova/gpt2',
    device: 'cpu',
  };

  configure(config: EngineConfig): void {
    this.engineConfig = { ...this.engineConfig, ...config };
  }

  async start(_modelPath: string): Promise<{ success: boolean; port?: number }> {
    this._running = true;
    return { success: true };
  }

  async stop(): Promise<{ success: boolean }> {
    this._running = false;
    return { success: true };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n') + '\nassistant:';
    const text = `[Transformers.js] Model: ${this.engineConfig.model}\n\nPrompt received. Full implementation requires @huggingface/transformers.\n`;
    return { stream: toGenerator(text) };
  }

  async health(): Promise<HealthStatus> {
    return { status: 'ok', engine: this.id };
  }
}
