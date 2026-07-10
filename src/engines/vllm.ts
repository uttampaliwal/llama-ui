import { LLMEngine, type ModelInfo, type ChatMessage, type GenerateOptions, type GenerateResult, type HealthStatus, type EngineConfig } from './base';
import { openaiStreamToGenerator } from './stream-utils';

export interface VLLMConfig extends EngineConfig {
  baseUrl: string;
  model: string;
}

export class VLLMEngine extends LLMEngine {
  readonly id = 'vllm';
  readonly name = 'vLLM';

  protected engineConfig: VLLMConfig = {
    baseUrl: process.env.VLLM_HOST || 'http://127.0.0.1:8000',
    model: 'default',
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
        sizeFormatted: 'Served',
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
        model: this.engineConfig.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.9,
        max_tokens: options?.maxTokens ?? 4096,
        stream: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`vLLM error ${res.status}`);
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
      return { status: 'error', engine: this.id, detail: 'Cannot reach vLLM' };
    }
  }
}
