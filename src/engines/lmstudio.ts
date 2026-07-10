import { LLMEngine, type ModelInfo, type ChatMessage, type GenerateOptions, type GenerateResult, type HealthStatus, type EngineConfig } from './base';
import { openaiStreamToGenerator } from './stream-utils';

export interface LMStudioConfig extends EngineConfig {
  baseUrl: string;
}

export class LMStudioEngine extends LLMEngine {
  readonly id = 'lmstudio';
  readonly name = 'LM Studio';

  protected engineConfig: LMStudioConfig = {
    baseUrl: process.env.LMSTUDIO_HOST || 'http://127.0.0.1:1234',
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
    try {
      const res = await fetch(`${this.engineConfig.baseUrl}/v1/models`);
      if (!res.ok) return [];
      const data = await res.json() as { data: Array<{ id: string; owned_by: string }> };
      return data.data.map((m) => ({
        name: m.id,
        id: m.id,
        size: 0,
        sizeFormatted: 'Unknown',
        provider: this.id,
        capabilities: [],
      }));
    } catch {
      return [];
    }
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
    const res = await fetch(`${this.engineConfig.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.9,
        top_k: options?.topK ?? 40,
        repeat_penalty: options?.repeatPenalty ?? 1.1,
        max_tokens: options?.maxTokens ?? 4096,
        stream: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`LM Studio error ${res.status}`);
    }

    return { stream: openaiStreamToGenerator(res) };
  }

  async health(): Promise<HealthStatus> {
    try {
      const res = await fetch(`${this.engineConfig.baseUrl}/v1/models`);
      if (res.ok) {
        return { status: 'ok', engine: this.id };
      }
      return { status: 'error', engine: this.id, detail: `HTTP ${res.status}` };
    } catch {
      return { status: 'error', engine: this.id, detail: 'Cannot reach LM Studio' };
    }
  }
}
