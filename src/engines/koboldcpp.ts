import { LLMEngine, type ModelInfo, type ChatMessage, type GenerateOptions, type GenerateResult, type HealthStatus, type EngineConfig } from './base';
import { toGenerator } from './stream-utils';

export interface KoboldCppConfig extends EngineConfig {
  baseUrl: string;
}

export class KoboldCppEngine extends LLMEngine {
  readonly id = 'koboldcpp';
  readonly name = 'KoboldCpp';

  protected engineConfig: KoboldCppConfig = {
    baseUrl: process.env.KOBOLDCPP_HOST || 'http://127.0.0.1:5001',
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
    const lastMsg = messages[messages.length - 1];
    const prompt = lastMsg?.content || '';

    const res = await fetch(`${this.engineConfig.baseUrl}/api/v1/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        max_length: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      throw new Error(`KoboldCpp error ${res.status}`);
    }

    const data = await res.json() as { results: Array<{ text: string }> };
    const text = data.results?.[0]?.text || '';

    return { stream: toGenerator(text) };
  }

  async health(): Promise<HealthStatus> {
    try {
      const res = await fetch(`${this.engineConfig.baseUrl}/api/v1/model`);
      if (res.ok) {
        return { status: 'ok', engine: this.id };
      }
      return { status: 'error', engine: this.id, detail: `HTTP ${res.status}` };
    } catch {
      return { status: 'error', engine: this.id, detail: 'Cannot reach KoboldCpp' };
    }
  }
}
